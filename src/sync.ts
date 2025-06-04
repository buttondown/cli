import axios from "axios";
import fs from "fs-extra";
import { glob } from "glob";
import path from "path";
import ButtondownApi, { Email, Newsletter } from "./api.js";

interface SyncOptions {
  directory: string;
  force?: boolean;
}

interface SyncedEmail {
  modified: string;
  localPath: string;
  slug?: string;
  contentHash?: string;
}

interface SyncedImage {
  id: string;
  localPath: string;
  url: string;
  creation_date: string;
  filename: string;
  lastSynced: string;
}

interface SyncedNewsletter {
  id: string;
  lastSynced: string;
  contentHash?: string;
}

const BRANDING_FILE = "branding.json";
const CSS_FILE = "custom.css";
const TEMPLATE_CSS_FILE = "template.css";

export class SyncManager {
  private api: ButtondownApi;
  private baseDir: string;
  private emailsDir: string;
  private mediaDir: string;
  private brandingDir: string;
  private cssDir: string;
  private configPath: string;

  constructor(options: SyncOptions) {
    this.api = new ButtondownApi();
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

    if (!(await fs.pathExists(this.configPath))) {
      await fs.writeJSON(this.configPath, {
        lastSync: null,
        syncedEmails: {},
        syncedImages: {},
        syncedNewsletter: null,
      });
    } else {
      // Ensure syncedImages exists in existing config files
      const config = await fs.readJSON(this.configPath);
      if (!config.syncedImages) {
        config.syncedImages = {};
      }
      if (!config.syncedNewsletter) {
        config.syncedNewsletter = null;
      }
      await fs.writeJSON(this.configPath, config, { spaces: 2 });
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
      hash = hash & hash; // Convert to 32bit integer
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
      newsletter.logo_url || "",
      newsletter.header_image_url || "",
      newsletter.accent_color || "",
      newsletter.font_family || "",
      newsletter.custom_css || "",
    ].join("|");

    // Simple hash function
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString();
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

    while (hasMore) {
      const { results, count } = await this.api.getEmails(page, pageSize);

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
        if (email.id) emailContent += `id: ${email.id}\n`;
        if (email.subject) emailContent += `subject: ${email.subject}\n`;
        if (email.status) emailContent += `status: ${email.status}\n`;
        if (email.email_type)
          emailContent += `email_type: ${email.email_type}\n`;
        if (email.slug) emailContent += `slug: ${email.slug}\n`;
        if (email.publish_date)
          emailContent += `publish_date: ${email.publish_date}\n`;
        if (email.created) emailContent += `created: ${email.created}\n`;
        if (email.modified) emailContent += `modified: ${email.modified}\n`;

        if (email.attachments && email.attachments.length > 0) {
          emailContent += "attachments:\n";
          for (const attachment of email.attachments) {
            emailContent += `  - ${attachment}\n`;
          }
        }

        emailContent += "---\n\n";
        emailContent += email.body;

        await fs.writeFile(emailPath, emailContent);

        syncedEmails[email.id] = {
          modified: email.modified,
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

    for (const emailFile of emailFiles) {
      const emailPath = path.join(this.emailsDir, emailFile);
      const content = await fs.readFile(emailPath, "utf-8");

      // Parse frontmatter and content
      const match = content.match(/^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/);

      if (!match) {
        console.warn(
          `Skipping ${emailFile}: Invalid format (missing frontmatter)`
        );
        continue;
      }

      const [, frontMatter, body] = match;
      const metadata: Record<string, any> = {};

      frontMatter.split("\n").forEach((line) => {
        const [key, ...valueParts] = line.split(":");
        if (key && valueParts.length) {
          const value = valueParts.join(":").trim();
          metadata[key.trim()] = value;
        }
      });

      const emailData: Partial<Email> = {
        body,
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
          await this.api.updateEmail(metadata.id, emailData);
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
          const newEmail = await this.api.createEmail(emailData);
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
              modified: newEmail.modified,
              localPath: newPath,
              slug: newEmail.slug,
              contentHash,
            };
          } else {
            syncedEmails[newEmail.id] = {
              modified: newEmail.modified,
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
        const { results, count } = await this.api.getImages(page, pageSize);

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

      const fileContent = await fs.readFile(filePath);

      try {
        // Upload the image
        const image = await this.api.uploadImage(fileContent, filename);

        // Update synced images record
        syncedImages[image.id] = {
          id: image.id,
          localPath: filePath,
          url: image.image,
          creation_date: image.creation_date,
          filename: filename,
          lastSynced: new Date().toISOString(),
        };

        uploaded++;
      } catch (error) {
        console.error(`Failed to upload ${mediaFile}:`, error);
      }
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
      const newsletter = await this.api.getNewsletter();

      if (!newsletter || !newsletter.id) {
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
    if (newsletter.custom_css) {
      const customCssPath = path.join(this.cssDir, CSS_FILE);
      await fs.writeFile(customCssPath, newsletter.custom_css);
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
        accent_color: newsletter.accent_color || null,
        header: newsletter.header || null,
        footer: newsletter.footer || null,
        from_name: newsletter.from_name || null,
        logo_url: newsletter.logo_url || null,
        header_image_url: newsletter.header_image_url || null,
        font_family: newsletter.font_family || null,
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
        const branding = brandingConfig.branding;
        if (branding.tint_color)
          newsletterData.tint_color = branding.tint_color;
        if (branding.accent_color)
          newsletterData.accent_color = branding.accent_color;
        if (branding.header) newsletterData.header = branding.header;
        if (branding.footer) newsletterData.footer = branding.footer;
        if (branding.from_name) newsletterData.from_name = branding.from_name;
        if (branding.logo_url) newsletterData.logo_url = branding.logo_url;
        if (branding.header_image_url)
          newsletterData.header_image_url = branding.header_image_url;
        if (branding.font_family)
          newsletterData.font_family = branding.font_family;
      }

      // Read CSS from files
      const { customCss } = await this.readCssFiles();
      if (customCss !== null) {
        newsletterData.custom_css = customCss;
      }

      // Calculate content hash
      const contentHash = this.generateNewsletterContentHash(newsletterData);

      // Check if newsletter settings have changed since last sync
      const syncedNewsletter =
        syncConfig.syncedNewsletter as SyncedNewsletter | null;
      const hasChanged =
        !syncedNewsletter || syncedNewsletter.contentHash !== contentHash;

      if (!hasChanged) {
        return { updated: false };
      }

      // Update newsletter via API
      const updatedNewsletter = await this.api.updateNewsletter(newsletterData);

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
