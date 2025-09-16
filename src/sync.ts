import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import createConfig from "./config.js";
import { type Client, createClient, ok } from "./lib/openapi-wrapper.js";
import type { components, paths } from "./lib/openapi.js";
import {
  type FrontMatterFields,
  deserialize,
  findRelativeImageReferences,
  hash,
  replaceImageReference,
  serialize,
} from "./lib/serde/email.js";
import { hash as genericHash } from "./lib/utils.js";

// TODO: DRY this with the version in package.json.
const VERSION = "1.0.3";

type Email = components["schemas"]["Email"];
type Newsletter = components["schemas"]["Newsletter"];

const PAGE_SIZE = 100;

type SyncOptions = {
  directory: string;
  force?: boolean;
  baseUrl?: string;
  apiKey?: string;
  verbose?: boolean;
};

type SyncedEmail = {
  modified: string;
  localPath: string;
  slug?: string;
  contentHash?: string;
};

type SyncedImage = {
  id: string;
  localPath: string;
  url: string;
  creation_date: string;
  filename: string;
  lastSynced: string;
};

type SyncedNewsletter = {
  id: string;
  lastSynced: string;
  contentHash?: string;
};

export type Output = {
  emails: { added: number; updated: number; unchanged: number };
  media: { downloaded: number; uploaded: number };
  branding: { updated: boolean };
};

const DEFAULT_OUTPUT: Output = {
  emails: { added: 0, updated: 0, unchanged: 0 },
  media: { downloaded: 0, uploaded: 0 },
  branding: { updated: false },
};

const BRANDING_FILE = "branding.json";
const CSS_FILE = "custom.css";
const TEMPLATE_CSS_FILE = "template.css";

const EXTENSION_TO_MIME_TYPE = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
};

const ABSOLUTE_IMAGE_URL_REGEX = /!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g;

export const convertAbsoluteToRelativeImages = (
  content: string,
  emailDir: string,
  syncedImages: Record<string, SyncedImage>
): string => {
  const regex = ABSOLUTE_IMAGE_URL_REGEX;
  let processedContent = content;

  processedContent = processedContent.replace(
    regex,
    (match, altText, imageUrl) => {
      const syncedImage = Object.values(syncedImages).find(
        (img) => img.url === imageUrl
      );

      if (syncedImage) {
        const relativePath = path.relative(emailDir, syncedImage.localPath);
        return `![${altText}](${relativePath})`;
      }

      return match;
    }
  );

  return processedContent;
};

type SyncConfig = {
  lastSync: string | null;
  syncedEmails: Record<string, SyncedEmail>;
  syncedImages: Record<string, SyncedImage>;
  syncedNewsletter: SyncedNewsletter | null;
};

const DEFAULT_SYNC_CONFIG: SyncConfig = {
  lastSync: null,
  syncedEmails: {},
  syncedImages: {},
  syncedNewsletter: null,
};

export class SyncManager {
  private readonly api: Client<paths>;
  private readonly baseDir: string;
  private readonly emailsDir: string;
  private readonly mediaDir: string;
  private readonly brandingDir: string;
  private readonly cssDir: string;
  private readonly configPath: string;
  private readonly verbose: boolean;

  constructor(options: SyncOptions) {
    const config = createConfig();
    const baseUrl = options.baseUrl || config.get("baseUrl");
    const apiKey = options.apiKey || config.get("apiKey");
    this.api = createClient<paths>({
      base: baseUrl,
      middlewares: [
        async (request, next) => {
          request.headers.set("authorization", `Token ${apiKey}`);
          request.headers.set("user-agent", `buttondown-cli/${VERSION}`);
          return next(request);
        },
      ],
    });
    this.baseDir = options.directory;
    this.emailsDir = path.join(this.baseDir, "emails");
    this.mediaDir = path.join(this.baseDir, "media");
    this.brandingDir = path.join(this.baseDir, "branding");
    this.cssDir = path.join(this.brandingDir, "css");
    this.configPath = path.join(this.baseDir, ".buttondown.json");
    this.verbose = options.verbose || false;
  }

  async initialize(): Promise<void> {
    await mkdir(this.emailsDir, { recursive: true });
    await mkdir(this.mediaDir, { recursive: true });
    await mkdir(this.brandingDir, { recursive: true });
    await mkdir(this.cssDir, { recursive: true });

    if (await existsSync(this.configPath)) {
      const config = await Bun.file(this.configPath).json();
      config.syncedImages ||= {};

      config.syncedNewsletter ||= null;

      await Bun.file(this.configPath).write(JSON.stringify(config, null, 2));
    } else {
      await Bun.file(this.configPath).write(
        JSON.stringify(DEFAULT_SYNC_CONFIG, null, 2)
      );
    }
  }

  private async uploadImage(imagePath: string): Promise<{
    id: string;
    url: string;
    filename: string;
  }> {
    const fileContent = await readFile(imagePath);
    const filename = path.basename(imagePath);

    console.log(`Uploading image: ${filename} (${fileContent.length} bytes)`);

    const formData = new FormData();
    const blob = new Blob([Buffer.from(fileContent)], {
      type: EXTENSION_TO_MIME_TYPE[
        path
          .extname(filename)
          .toLowerCase() as keyof typeof EXTENSION_TO_MIME_TYPE
      ],
    });
    if (!blob.type) {
      throw new Error(`Unknown file type: ${filename}`);
    }
    formData.append("image", blob, filename);

    try {
      const image = await ok(
        this.api.post("/images", {
          body: formData,
        })
      );

      console.log(`✅ Successfully uploaded image: ${image.id}`);
      return {
        id: image.id,
        url: image.image,
        filename,
      };
    } catch (error) {
      console.error(`❌ Failed to upload image ${filename}:`, error);
      throw error;
    }
  }

  async pullEmails(): Promise<Output["emails"]> {
    let page = 1;
    let hasMore = true;
    const syncResults: Output["emails"] = DEFAULT_OUTPUT.emails;

    const syncConfig = await Bun.file(this.configPath).json();
    const syncedEmails = syncConfig.syncedEmails || {};
    const syncedImages = syncConfig.syncedImages || {};

    while (hasMore) {
      const { results } = await ok(
        this.api.get("/emails", {
          params: {
            query: {
              // @ts-expect-error
              page,
              page_size: PAGE_SIZE,
            },
          },
        })
      );

      for (const email of results) {
        const filenameBase = email.slug || email.id;
        const emailPath = path.join(this.emailsDir, `${filenameBase}.md`);
        const emailExists = await existsSync(emailPath);

        const contentHash = hash(email);

        const previousSync = syncedEmails[email.id] as SyncedEmail | undefined;
        const hasChanged =
          !previousSync || previousSync.contentHash !== contentHash;

        if (emailExists && !hasChanged) {
          syncResults.unchanged++;
          continue;
        }

        const processedBody = convertAbsoluteToRelativeImages(
          email.body,
          this.emailsDir,
          syncedImages
        );

        const emailWithProcessedBody = { ...email, body: processedBody };
        const emailContent = serialize(emailWithProcessedBody);

        await writeFile(emailPath, emailContent);

        syncedEmails[email.id] = {
          modified: email.modification_date,
          localPath: emailPath,
          slug: email.slug,
          contentHash,
        };

        if (emailExists) {
          syncResults.updated++;
        } else {
          syncResults.added++;
        }
      }

      hasMore = results.length === PAGE_SIZE;
      page++;
    }

    syncConfig.lastSync = new Date().toISOString();
    syncConfig.syncedEmails = syncedEmails;
    await Bun.file(this.configPath).write(JSON.stringify(syncConfig, null, 2));

    return syncResults;
  }

  async pushEmails(): Promise<Output["emails"]> {
    const syncResults: Output["emails"] = DEFAULT_OUTPUT.emails;

    const glob = new Bun.Glob("**/*.md");
    const emailFiles = await glob.scan(this.emailsDir);
    const syncConfig = (await Bun.file(this.configPath).json()) as SyncConfig;
    const syncedEmails = syncConfig.syncedEmails || {};
    const syncedImages = syncConfig.syncedImages || {};

    for await (const emailFile of emailFiles) {
      const emailPath = path.join(this.emailsDir, emailFile);
      const content = await readFile(emailPath, "utf8");

      const parsed = deserialize(content);

      if (!parsed.isValid) {
        console.warn(`Skipping ${emailFile}: ${parsed.error}`);
        continue;
      }

      const { email } = parsed;

      if (this.verbose) {
        console.log(`Processing email: ${emailFile}`);
      }

      const emailDir = path.dirname(emailPath);

      const relativeImages = findRelativeImageReferences(content);
      const uploadedImages = [];
      let processedContent = content;

      for (const imageRef of relativeImages) {
        const absolutePath = path.resolve(emailDir, imageRef.relativePath);

        if (await existsSync(absolutePath)) {
          const existingImage = Object.values(syncedImages).find(
            (img: SyncedImage) => img.localPath === absolutePath
          ) as SyncedImage | undefined;

          let imageUrl: string;
          let imageId: string;
          let filename: string;

          if (existingImage) {
            console.log(
              `Using existing uploaded image: ${existingImage.filename}`
            );
            imageUrl = existingImage.url;
            imageId = existingImage.id;
            filename = existingImage.filename;
          } else {
            try {
              const uploadedImage = await this.uploadImage(absolutePath);
              imageUrl = uploadedImage.url;
              imageId = uploadedImage.id;
              filename = uploadedImage.filename;

              uploadedImages.push({
                id: imageId,
                localPath: absolutePath,
                url: imageUrl,
                filename,
              });
            } catch (error) {
              console.warn(
                `Failed to upload image ${absolutePath}:`,
                error instanceof Error ? error.message : String(error)
              );
              continue;
            }
          }

          processedContent = replaceImageReference(
            processedContent,
            imageRef.match,
            imageUrl,
            imageRef.altText
          );
        } else {
          console.warn(`Image not found: ${absolutePath}`);
        }
      }

      for (const uploadedImage of uploadedImages) {
        syncedImages[uploadedImage.id] = {
          id: uploadedImage.id,
          localPath: uploadedImage.localPath,
          url: uploadedImage.url,
          creation_date: new Date().toISOString(),
          filename: uploadedImage.filename,
          lastSynced: new Date().toISOString(),
        };
      }

      const updatedEmail: Partial<Email & FrontMatterFields> = {
        ...email,
        body: processedContent,
      };

      if (email.id) {
        const previousSync = syncedEmails[email.id] as SyncedEmail | undefined;
        const hasChanged =
          !previousSync || previousSync.contentHash !== hash(updatedEmail);

        if (!hasChanged) {
          syncResults.unchanged++;
          continue;
        }

        try {
          await ok(
            this.api.patch("/emails/{id}", {
              params: {
                path: {
                  id: email.id,
                },
              },
              body: {
                ...updatedEmail,
              },
            })
          );
          syncResults.updated++;

          syncedEmails[email.id] = {
            modified: new Date().toISOString(),
            localPath: emailPath,
            slug: email.slug || path.basename(emailFile, ".md"),
            contentHash: hash(updatedEmail),
          };
        } catch (error) {
          console.error(`Failed to update email ${email.id}:`, error);
        }
      } else {
        try {
          const newEmail = await ok(
            this.api.post("/emails", {
              body: {
                ...updatedEmail,
                subject: updatedEmail.subject || "",
              },
            })
          );
          syncResults.added++;
          await writeFile(emailPath, serialize(updatedEmail));

          if (
            newEmail.slug &&
            path.basename(emailFile, ".md") !== newEmail.slug
          ) {
            const newPath = path.join(this.emailsDir, `${newEmail.slug}.md`);
            await rename(emailPath, newPath);

            syncedEmails[newEmail.id] = {
              modified: newEmail.modification_date,
              localPath: newPath,
              slug: newEmail.slug,
              contentHash: hash(updatedEmail),
            };
          } else {
            syncedEmails[newEmail.id] = {
              modified: newEmail.modification_date,
              localPath: emailPath,
              slug: newEmail.slug,
              contentHash: hash(updatedEmail),
            };
          }
        } catch (error) {
          console.error("Failed to create email:", error);
        }
      }
    }

    syncConfig.lastSync = new Date().toISOString();
    syncConfig.syncedEmails = syncedEmails;
    syncConfig.syncedImages = syncedImages;
    await Bun.file(this.configPath).write(JSON.stringify(syncConfig, null, 2));

    return syncResults;
  }

  async pullMedia(): Promise<Output["media"]> {
    let downloaded = 0;
    let page = 1;
    let hasMore = true;

    const syncConfig = (await Bun.file(this.configPath).json()) as SyncConfig;
    const syncedImages = syncConfig.syncedImages || {};

    while (hasMore) {
      try {
        const { results } = await ok(
          this.api.get("/images", {
            params: {
              query: {
                page,
                page_size: PAGE_SIZE,
              },
            },
          })
        );

        for (const image of results) {
          const existingImage = Object.values(syncedImages).find(
            (img: any) => img.id === image.id
          ) as SyncedImage | undefined;

          if (existingImage && (await existsSync(existingImage.localPath))) {
            continue;
          }

          let filename = path.basename(image.image);
          if (!filename.includes(".")) {
            filename = `${image.id}.jpg`;
          }

          const localPath = path.join(this.mediaDir, filename);

          try {
            const response = await fetch(image.image);
            if (!response.ok) {
              throw new Error(`Failed to fetch image: ${response.statusText}`);
            }
            const arrayBuffer = await response.arrayBuffer();

            await writeFile(localPath, Buffer.from(arrayBuffer));

            syncedImages[image.id] = {
              id: image.id,
              localPath,
              url: image.image,
              creation_date: image.creation_date,
              filename,
              lastSynced: new Date().toISOString(),
            };

            downloaded++;
          } catch (error) {
            console.error(`Failed to download image ${image.id}:`, error);
          }
        }

        hasMore = results.length === PAGE_SIZE;
        page++;
      } catch (error) {
        console.error("Error fetching images:", error);
        break;
      }
    }

    syncConfig.syncedImages = syncedImages;
    await Bun.file(this.configPath).write(JSON.stringify(syncConfig, null, 2));

    return { downloaded, uploaded: 0 };
  }

  async pushMedia(): Promise<Output["media"]> {
    let uploaded = 0;

    const glob = new Bun.Glob("**/*");

    const syncConfig = (await Bun.file(this.configPath).json()) as SyncConfig;
    const syncedImages = syncConfig.syncedImages || {};

    for await (const mediaFile of glob.scan(this.mediaDir)) {
      const filePath = path.join(this.mediaDir, mediaFile);
      const filename = path.basename(mediaFile);

      const existingImage = Object.values(syncedImages).find(
        (img: any) => img.localPath === filePath
      ) as SyncedImage | undefined;

      if (existingImage) {
        continue;
      }

      const image = await this.uploadImage(filePath);
      syncedImages[image.id] = {
        id: image.id,
        localPath: filePath,
        url: image.url,
        creation_date: new Date().toISOString(),
        filename,
        lastSynced: new Date().toISOString(),
      };

      uploaded++;
    }

    syncConfig.syncedImages = syncedImages;
    await Bun.file(this.configPath).write(JSON.stringify(syncConfig, null, 2));

    return { uploaded, downloaded: 0 };
  }

  async pullNewsletterMetadata(): Promise<{ updated: boolean }> {
    try {
      const syncConfig = await Bun.file(this.configPath).json();

      const newsletters = await ok(this.api.get("/newsletters"));
      const newsletter = newsletters.results[0];

      if (!newsletter?.id) {
        console.error("Failed to retrieve newsletter data or missing ID");
        return { updated: false };
      }

      const contentHash = genericHash([
        newsletter.name || "",
        newsletter.description || "",
        newsletter.username || "",
        newsletter.tint_color || "",
        newsletter.header || "",
        newsletter.footer || "",
        newsletter.from_name || "",
      ]);

      const brandingPath = path.join(this.brandingDir, BRANDING_FILE);
      await Bun.file(brandingPath).write(
        JSON.stringify(
          {
            name: newsletter.name || "",
            description: newsletter.description || "",
            username: newsletter.username || "",
            branding: {
              tint_color: newsletter.tint_color || null,
              header: newsletter.header || null,
              footer: newsletter.footer || null,
              from_name: newsletter.from_name || null,
            },
          },
          null,
          2
        )
      );

      if (newsletter.css) {
        const customCssPath = path.join(this.cssDir, CSS_FILE);
        await writeFile(customCssPath, newsletter.css);
      }

      const templateCssPath = path.join(this.cssDir, TEMPLATE_CSS_FILE);
      if (!(await existsSync(templateCssPath))) {
        await writeFile(
          templateCssPath,
          `/*
 * This file is for template CSS that will be shared across emails
 * You can include this in your custom CSS by using:
 * @import url('template.css');
 */`
        );
      }

      syncConfig.syncedNewsletter = {
        id: newsletter.id,
        lastSynced: new Date().toISOString(),
        contentHash,
      };
      await Bun.file(this.configPath).write(
        JSON.stringify(syncConfig, null, 2)
      );

      return { updated: true };
    } catch (error) {
      console.error("Failed to pull newsletter metadata:", error);
      return { updated: false };
    }
  }

  async pushNewsletterMetadata(): Promise<{ updated: boolean }> {
    try {
      const brandingPath = path.join(this.brandingDir, BRANDING_FILE);

      if (!(await existsSync(brandingPath))) {
        return { updated: false };
      }

      const syncConfig = await Bun.file(this.configPath).json();
      const brandingConfig = await Bun.file(brandingPath).json();

      const newsletterData: Partial<Newsletter> = {
        name: brandingConfig.name,
        description: brandingConfig.description,
        username: brandingConfig.username,
      };

      if (brandingConfig.branding) {
        const { branding } = brandingConfig;
        if (branding.tint_color) {
          newsletterData.tint_color = branding.tint_color;
        }

        if (branding.header) {
          newsletterData.header = branding.header;
        }

        if (branding.footer) {
          newsletterData.footer = branding.footer;
        }

        if (branding.from_name) {
          newsletterData.from_name = branding.from_name;
        }
      }

      const customCssPath = path.join(this.cssDir, CSS_FILE);

      let customCss = null;
      if (await existsSync(customCssPath)) {
        customCss = await readFile(customCssPath, "utf8");
      }

      if (customCss !== null) {
        newsletterData.css = customCss;
      }

      const contentHash = genericHash([
        newsletterData.name || "",
        newsletterData.description || "",
        newsletterData.username || "",
        newsletterData.tint_color || "",
        newsletterData.header || "",
        newsletterData.footer || "",
        newsletterData.from_name || "",
      ]);

      const syncedNewsletter = syncConfig.syncedNewsletter as
        | SyncedNewsletter
        | undefined;
      const hasChanged =
        !syncedNewsletter || syncedNewsletter.contentHash !== contentHash;

      if (!hasChanged) {
        return { updated: false };
      }

      const updatedNewsletter = await ok(
        this.api.patch("/newsletters/{id}", {
          params: {
            path: {
              id: syncConfig.syncedNewsletter?.id,
            },
          },
          body: newsletterData,
        })
      );

      syncConfig.syncedNewsletter = {
        id: updatedNewsletter.id,
        lastSynced: new Date().toISOString(),
        contentHash,
      };
      await Bun.file(this.configPath).write(
        JSON.stringify(syncConfig, null, 2)
      );

      return { updated: true };
    } catch (error) {
      console.error("Failed to push newsletter metadata:", error);
      return { updated: false };
    }
  }
}
