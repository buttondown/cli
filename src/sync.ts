import path from "node:path";
import axios from "axios";
import fs from "fs-extra";
import { glob } from "glob";
import createConfig from "./config.js";
import { type Client, createClient, ok } from "./lib/openapi-wrapper.js";
import type { components, paths } from "./lib/openapi.js";

// TODO: DRY this with the version in package.json.
const VERSION = "1.0.2";

type Email = components["schemas"]["Email"];
type Newsletter = components["schemas"]["Newsletter"];

type SyncOptions = {
  directory: string;
  force?: boolean;
  baseUrl?: string;
  apiKey?: string;
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

const BRANDING_FILE = "branding.json";
const CSS_FILE = "custom.css";
const TEMPLATE_CSS_FILE = "template.css";

export class SyncManager {
  private readonly api: Client<paths>;
  private readonly baseDir: string;
  private readonly emailsDir: string;
  private readonly mediaDir: string;
  private readonly brandingDir: string;
  private readonly cssDir: string;
  private readonly configPath: string;

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
  }

  async initialize(): Promise<void> {
    await fs.ensureDir(this.emailsDir);
    await fs.ensureDir(this.mediaDir);
    await fs.ensureDir(this.brandingDir);
    await fs.ensureDir(this.cssDir);

    if (await fs.pathExists(this.configPath)) {
      // Ensure syncedImages exists in existing config files
      const config = await fs.readJSON(this.configPath);
      config.syncedImages ||= {};

      config.syncedNewsletter ||= null;

      await fs.writeJSON(this.configPath, config, { spaces: 2 });
    } else {
      await fs.writeJSON(this.configPath, {
        lastSync: null,
        syncedEmails: {},
        syncedImages: {},
        syncedNewsletter: null,
      });
    }
  }

  // Generate a simple hash of the email content to detect changes
  private generateContentHash(email: Email | Partial<Email>): string {
    const content = [
      email.subject || "",
      email.body || "",
      email.status || "",
      email.email_type || "",
      email.slug || "",
      email.publish_date || "",
      JSON.stringify(email.attachments || []),
    ].join("|");

    // Simple hash function
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash &= hash; // Convert to 32bit integer
    }

    return hash.toString();
  }

  // Generate a simple hash of the newsletter content to detect changes
  private generateNewsletterContentHash(
    newsletter: Newsletter | Partial<Newsletter>
  ): string {
    const content = [
      newsletter.name || "",
      newsletter.description || "",
      newsletter.username || "",
      newsletter.tint_color || "",
      newsletter.header || "",
      newsletter.footer || "",
      newsletter.from_name || "",
    ].join("|");

    // Simple hash function
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash &= hash; // Convert to 32bit integer
    }

    return hash.toString();
  }

  // Find relative image references in markdown content
  findRelativeImageReferences(content: string): Array<{
    match: string;
    altText: string;
    relativePath: string;
  }> {
    const regex = /!\[([^\]]*)\]\(([^)]+)\)/g;
    const results = [];
    let match;

    while ((match = regex.exec(content)) !== null) {
      const [fullMatch, altText, imagePath] = match;

      // Check if it's a relative path (not starting with http/https//)
      if (!imagePath.startsWith("http") && !imagePath.startsWith("//")) {
        results.push({
          match: fullMatch,
          altText,
          relativePath: imagePath,
        });
      }
    }

    return results;
  }

  // Upload image and return the uploaded image info
  private async uploadImage(imagePath: string): Promise<{
    id: string;
    url: string;
    filename: string;
  }> {
    const fileContent = await fs.readFile(imagePath);
    const filename = path.basename(imagePath);

    console.log(`Uploading image: ${filename} (${fileContent.length} bytes)`);

    // Create FormData with proper file handling for Node.js
    const formData = new FormData();
    const blob = new Blob([fileContent], {
      type: this.getMimeType(filename),
    });
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

  // Helper method to get MIME type based on file extension
  private getMimeType(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes: Record<string, string> = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".svg": "image/svg+xml",
      ".bmp": "image/bmp",
      ".ico": "image/x-icon",
    };
    return mimeTypes[ext] || "application/octet-stream";
  }

  // Convert relative image references to absolute URLs
  private async processRelativeImages(
    content: string,
    emailDir: string,
    syncedImages: Record<string, SyncedImage>
  ): Promise<{
    processedContent: string;
    uploadedImages: Array<{
      id: string;
      localPath: string;
      url: string;
      filename: string;
    }>;
  }> {
    const relativeImages = this.findRelativeImageReferences(content);
    const uploadedImages = [];
    let processedContent = content;

    for (const imageRef of relativeImages) {
      const absolutePath = path.resolve(emailDir, imageRef.relativePath);

      if (await fs.pathExists(absolutePath)) {
        // Check if this image has already been uploaded
        const existingImage = Object.values(syncedImages).find(
          (img) => img.localPath === absolutePath
        );

        let imageUrl: string;
        let imageId: string;
        let filename: string;

        if (existingImage) {
          // Use existing uploaded image
          console.log(
            `Using existing uploaded image: ${existingImage.filename}`
          );
          imageUrl = existingImage.url;
          imageId = existingImage.id;
          filename = existingImage.filename;
        } else {
          // Upload new image
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
            // Keep the original relative reference if upload fails
            continue;
          }
        }

        // Replace the relative reference with the absolute URL
        const newReference = `![${imageRef.altText}](${imageUrl})`;
        processedContent = processedContent.replace(
          imageRef.match,
          newReference
        );
      } else {
        console.warn(`Image not found: ${absolutePath}`);
      }
    }

    return { processedContent, uploadedImages };
  }

  // Convert absolute image URLs back to relative paths
  private convertAbsoluteToRelativeImages(
    content: string,
    emailDir: string,
    syncedImages: Record<string, SyncedImage>
  ): string {
    const regex = /!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g;
    let processedContent = content;

    processedContent = processedContent.replace(
      regex,
      (match, altText, imageUrl) => {
        // Find the synced image by URL
        const syncedImage = Object.values(syncedImages).find(
          (img) => img.url === imageUrl
        );

        if (syncedImage) {
          // Calculate relative path from email directory to the image
          const relativePath = path.relative(emailDir, syncedImage.localPath);
          return `![${altText}](${relativePath})`;
        }

        // If we can't find the image in our sync records, leave it as absolute
        return match;
      }
    );

    return processedContent;
  }

  async pullEmails(): Promise<{
    added: number;
    updated: number;
    unchanged: number;
  }> {
    let page = 1;
    const pageSize = 100;
    let hasMore = true;
    let added = 0;
    let updated = 0;
    let unchanged = 0;

    const syncConfig = await fs.readJSON(this.configPath);
    const syncedEmails = syncConfig.syncedEmails || {};
    const syncedImages = syncConfig.syncedImages || {};

    while (hasMore) {
      const { results } = await ok(
        this.api.get("/emails", {
          params: {
            query: {
              // @ts-expect-error
              page,
              page_size: pageSize,
            },
          },
        })
      );

      for (const email of results) {
        // Use slug for filename, fallback to ID if no slug
        const filenameBase = email.slug || email.id;
        const emailPath = path.join(this.emailsDir, `${filenameBase}.md`);
        const emailExists = await fs.pathExists(emailPath);

        // Calculate content hash
        const contentHash = this.generateContentHash(email);

        // Check if this email has changed since last sync
        const previousSync = syncedEmails[email.id] as SyncedEmail | undefined;
        const hasChanged =
          !previousSync || previousSync.contentHash !== contentHash;

        if (emailExists && !hasChanged) {
          // Email exists locally and hasn't changed, skip updating
          unchanged++;
          continue;
        }

        // Create email markdown with front matter
        let emailContent = "---\n";

        // Only add properties that exist and are not undefined
        if (email.id) {
          emailContent += `id: ${email.id}\n`;
        }

        if (email.subject) {
          emailContent += `subject: ${email.subject}\n`;
        }

        if (email.status) {
          emailContent += `status: ${email.status}\n`;
        }

        if (email.email_type) {
          emailContent += `email_type: ${email.email_type}\n`;
        }

        if (email.slug) {
          emailContent += `slug: ${email.slug}\n`;
        }

        if (email.publish_date) {
          emailContent += `publish_date: ${email.publish_date}\n`;
        }

        if (email.creation_date) {
          emailContent += `created: ${email.creation_date}\n`;
        }

        if (email.modification_date) {
          emailContent += `modified: ${email.modification_date}\n`;
        }

        if (email.attachments && email.attachments.length > 0) {
          emailContent += "attachments:\n";
          for (const attachment of email.attachments) {
            emailContent += `  - ${attachment}\n`;
          }
        }

        emailContent += "---\n\n";

        // Convert absolute image URLs to relative paths
        const processedBody = this.convertAbsoluteToRelativeImages(
          email.body,
          this.emailsDir,
          syncedImages
        );
        emailContent += processedBody;

        await fs.writeFile(emailPath, emailContent);

        syncedEmails[email.id] = {
          modified: email.modification_date,
          localPath: emailPath,
          slug: email.slug,
          contentHash,
        };

        if (emailExists) {
          updated++;
        } else {
          added++;
        }
      }

      hasMore = results.length === pageSize;
      page++;
    }

    // Update sync config
    syncConfig.lastSync = new Date().toISOString();
    syncConfig.syncedEmails = syncedEmails;
    await fs.writeJSON(this.configPath, syncConfig, { spaces: 2 });

    return { added, updated, unchanged };
  }

  async pushEmails(): Promise<{
    added: number;
    updated: number;
    unchanged: number;
  }> {
    let added = 0;
    let updated = 0;
    let unchanged = 0;

    const emailFiles = await glob("**/*.md", { cwd: this.emailsDir });
    const syncConfig = await fs.readJSON(this.configPath);
    const syncedEmails = syncConfig.syncedEmails || {};
    const syncedImages = syncConfig.syncedImages || {};

    for (const emailFile of emailFiles) {
      const emailPath = path.join(this.emailsDir, emailFile);
      const content = await fs.readFile(emailPath, "utf8");

      // Parse frontmatter and content
      const match = /^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/.exec(content);

      if (!match) {
        console.warn(
          `Skipping ${emailFile}: Invalid format (missing frontmatter)`
        );
        continue;
      }

      const [, frontMatter, body] = match;
      const metadata: Record<string, any> = {};

      for (const line of frontMatter.split("\n")) {
        const [key, ...valueParts] = line.split(":");
        if (key && valueParts.length > 0) {
          const value = valueParts.join(":").trim();
          metadata[key.trim()] = value;
        }
      }

      // Process relative images and convert to absolute URLs
      const emailDir = path.dirname(emailPath);
      const { processedContent, uploadedImages } =
        await this.processRelativeImages(body, emailDir, syncedImages);

      // Update synced images config with newly uploaded images
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

      const emailData: Partial<Email> = {
        body: processedContent,
        subject: metadata.subject,
        email_type: metadata.email_type || "draft",
        status: metadata.status || "draft",
      };

      if (metadata.slug) {
        emailData.slug = metadata.slug;
      }

      if (metadata.publish_date) {
        emailData.publish_date = metadata.publish_date;
      }

      // Calculate content hash
      const contentHash = this.generateContentHash(emailData);

      if (metadata.id) {
        // Check if content has changed before updating
        const previousSync = syncedEmails[metadata.id] as
          | SyncedEmail
          | undefined;
        const hasChanged =
          !previousSync || previousSync.contentHash !== contentHash;

        if (!hasChanged) {
          // Content hasn't changed, skip updating
          unchanged++;
          continue;
        }

        // Update existing email
        try {
          await ok(
            this.api.patch("/emails/{id}", {
              params: {
                path: {
                  id: metadata.id,
                },
              },
              body: {
                subject: emailData.subject,
                body: emailData.body,
                status: emailData.status,
                email_type: emailData.email_type,
                slug: emailData.slug,
              },
            })
          );
          updated++;

          syncedEmails[metadata.id] = {
            modified: new Date().toISOString(),
            localPath: emailPath,
            slug: metadata.slug || path.basename(emailFile, ".md"),
            contentHash,
          };
        } catch (error) {
          console.error(`Failed to update email ${metadata.id}:`, error);
        }
      } else {
        // Create new email
        try {
          const newEmail = await ok(
            this.api.post("/emails", {
              body: {
                subject: emailData.subject || "",
                body: emailData.body,
                status: emailData.status,
                email_type: emailData.email_type,
                slug: emailData.slug,
              },
            })
          );
          added++;

          // Update the local file with the new ID and slug
          let updatedContent = content.replace(
            /^---\n/,
            `---\nid: ${newEmail.id}\n`
          );

          if (newEmail.slug && !metadata.slug) {
            // If we have a new slug and didn't have one before, add it to frontmatter
            updatedContent = updatedContent.replace(
              /^---\nid: [^\n]+\n/,
              `---\nid: ${newEmail.id}\nslug: ${newEmail.slug}\n`
            );
          }

          await fs.writeFile(emailPath, updatedContent);

          // If the email has a slug, rename the file to use it
          if (
            newEmail.slug &&
            path.basename(emailFile, ".md") !== newEmail.slug
          ) {
            const newPath = path.join(this.emailsDir, `${newEmail.slug}.md`);
            await fs.rename(emailPath, newPath);

            syncedEmails[newEmail.id] = {
              modified: newEmail.modification_date,
              localPath: newPath,
              slug: newEmail.slug,
              contentHash,
            };
          } else {
            syncedEmails[newEmail.id] = {
              modified: newEmail.modification_date,
              localPath: emailPath,
              slug: newEmail.slug,
              contentHash,
            };
          }
        } catch (error) {
          console.error("Failed to create email:", error);
        }
      }
    }

    // Update sync config
    syncConfig.lastSync = new Date().toISOString();
    syncConfig.syncedEmails = syncedEmails;
    syncConfig.syncedImages = syncedImages;
    await fs.writeJSON(this.configPath, syncConfig, { spaces: 2 });

    return { added, updated, unchanged };
  }

  async pullMedia(): Promise<{ downloaded: number }> {
    let downloaded = 0;
    let page = 1;
    const pageSize = 100;
    let hasMore = true;

    const syncConfig = await fs.readJSON(this.configPath);
    const syncedImages = syncConfig.syncedImages || {};

    while (hasMore) {
      try {
        const { results } = await ok(
          this.api.get("/images", {
            params: {
              query: {
                page,
                page_size: pageSize,
              },
            },
          })
        );

        for (const image of results) {
          // Check if image already exists locally
          const existingImage = Object.values(syncedImages).find(
            (img: any) => img.id === image.id
          ) as SyncedImage | undefined;

          // If image exists locally and is up-to-date, skip
          if (existingImage && (await fs.pathExists(existingImage.localPath))) {
            continue;
          }

          // Extract filename from image URL or use the image ID
          let filename = path.basename(image.image);
          if (!filename.includes(".")) {
            // If URL doesn't have an extension, use ID with jpg extension
            filename = `${image.id}.jpg`;
          }

          const localPath = path.join(this.mediaDir, filename);

          try {
            // Download the image file
            const response = await axios.get(image.image, {
              responseType: "arraybuffer",
            });

            await fs.writeFile(localPath, Buffer.from(response.data));

            // Update synced images record
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

        hasMore = results.length === pageSize;
        page++;
      } catch (error) {
        console.error("Error fetching images:", error);
        break;
      }
    }

    // Update sync config with downloaded images
    syncConfig.syncedImages = syncedImages;
    await fs.writeJSON(this.configPath, syncConfig, { spaces: 2 });

    return { downloaded };
  }

  async pushMedia(): Promise<{ uploaded: number }> {
    let uploaded = 0;

    const mediaFiles = await glob("**/*", {
      cwd: this.mediaDir,
      nodir: true,
    });

    const syncConfig = await fs.readJSON(this.configPath);
    const syncedImages = syncConfig.syncedImages || {};

    for (const mediaFile of mediaFiles) {
      const filePath = path.join(this.mediaDir, mediaFile);
      const filename = path.basename(mediaFile);

      // Check if the file is already tracked in the syncedImages
      const existingImage = Object.values(syncedImages).find(
        (img: any) => img.localPath === filePath
      ) as SyncedImage | undefined;

      // If we already have this file in our tracking, skip it
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

    // Update sync config
    syncConfig.syncedImages = syncedImages;
    await fs.writeJSON(this.configPath, syncConfig, { spaces: 2 });

    return { uploaded };
  }

  async pullNewsletterMetadata(): Promise<{ updated: boolean }> {
    try {
      const syncConfig = await fs.readJSON(this.configPath);

      // Get newsletter data from API
      const newsletters = await ok(this.api.get("/newsletters"));
      const newsletter = newsletters.results[0];

      if (!newsletter?.id) {
        console.error("Failed to retrieve newsletter data or missing ID");
        return { updated: false };
      }

      // Calculate content hash
      const contentHash = this.generateNewsletterContentHash(newsletter);

      // Create user-friendly branding config
      const brandingConfig = this.createBrandingConfig(newsletter);
      const brandingPath = path.join(this.brandingDir, BRANDING_FILE);
      await fs.writeJSON(brandingPath, brandingConfig, { spaces: 2 });

      // Save CSS files separately for easier editing
      await this.saveCssFiles(newsletter);

      // Update sync config
      syncConfig.syncedNewsletter = {
        id: newsletter.id,
        lastSynced: new Date().toISOString(),
        contentHash,
      };
      await fs.writeJSON(this.configPath, syncConfig, { spaces: 2 });

      return { updated: true };
    } catch (error) {
      console.error("Failed to pull newsletter metadata:", error);
      return { updated: false };
    }
  }

  private async saveCssFiles(newsletter: Newsletter): Promise<void> {
    // Save custom CSS to a separate file if it exists
    if (newsletter.css) {
      const customCssPath = path.join(this.cssDir, CSS_FILE);
      await fs.writeFile(customCssPath, newsletter.css);
    }

    // Prepare an empty template file if it doesn't exist yet
    const templateCssPath = path.join(this.cssDir, TEMPLATE_CSS_FILE);
    if (!(await fs.pathExists(templateCssPath))) {
      await fs.writeFile(
        templateCssPath,
        `/* 
 * This file is for template CSS that will be shared across emails
 * You can include this in your custom CSS by using:
 * @import url('template.css');
 */`
      );
    }
  }

  private async readCssFiles(): Promise<{ customCss: string | null }> {
    const customCssPath = path.join(this.cssDir, CSS_FILE);

    let customCss = null;
    if (await fs.pathExists(customCssPath)) {
      customCss = await fs.readFile(customCssPath, "utf8");
    }

    return { customCss };
  }

  private createBrandingConfig(newsletter: Newsletter): any {
    // Remove CSS from branding.json since it will be in separate files
    return {
      name: newsletter.name || "",
      description: newsletter.description || "",
      username: newsletter.username || "",
      branding: {
        tint_color: newsletter.tint_color || null,
        header: newsletter.header || null,
        footer: newsletter.footer || null,
        from_name: newsletter.from_name || null,
      },
    };
  }

  async pushNewsletterMetadata(): Promise<{ updated: boolean }> {
    try {
      const brandingPath = path.join(this.brandingDir, BRANDING_FILE);

      // If branding file doesn't exist, nothing to push
      if (!(await fs.pathExists(brandingPath))) {
        return { updated: false };
      }

      const syncConfig = await fs.readJSON(this.configPath);
      const brandingConfig = await fs.readJSON(brandingPath);

      // Extract branding data from config
      const newsletterData: Partial<Newsletter> = {
        name: brandingConfig.name,
        description: brandingConfig.description,
        username: brandingConfig.username,
      };

      // Add branding fields if they exist
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

      // Read CSS from files
      const { customCss } = await this.readCssFiles();
      if (customCss !== null) {
        newsletterData.css = customCss;
      }

      // Calculate content hash
      const contentHash = this.generateNewsletterContentHash(newsletterData);

      // Check if newsletter settings have changed since last sync
      const syncedNewsletter = syncConfig.syncedNewsletter as
        | SyncedNewsletter
        | undefined;
      const hasChanged =
        !syncedNewsletter || syncedNewsletter.contentHash !== contentHash;

      if (!hasChanged) {
        return { updated: false };
      }

      // Update newsletter via API
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

      // Update sync config
      syncConfig.syncedNewsletter = {
        id: updatedNewsletter.id,
        lastSynced: new Date().toISOString(),
        contentHash,
      };
      await fs.writeJSON(this.configPath, syncConfig, { spaces: 2 });

      return { updated: true };
    } catch (error) {
      console.error("Failed to push newsletter metadata:", error);
      return { updated: false };
    }
  }
}
