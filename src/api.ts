import axios, { AxiosInstance } from "axios";
import Conf from "conf";

const config = new Conf({ projectName: "buttondown-cli" });

interface ButtondownConfig {
  apiKey?: string;
  baseUrl?: string;
}

// TODO: pull from OpenAPI spec!
export interface Email {
  id: string;
  subject: string;
  body: string;
  status: string;
  slug: string;
  publish_date?: string;
  created: string;
  modified: string;
  email_type: string;
  excluded_subscribers?: string[];
  included_subscribers?: string[];
  attachments?: string[];
}

export interface Image {
  id: string;
  creation_date: string;
  image: string;
}

export interface Newsletter {
  id: string;
  api_key: string;
  creation_date: string;
  description: string;
  name: string;
  username: string;

  // Branding fields
  tint_color?: string;
  header?: string;
  footer?: string;
  from_name?: string;

  // Additional branding fields
  logo_url?: string;
  header_image_url?: string;
  accent_color?: string;
  font_family?: string;
  custom_css?: string;
}

export default class ButtondownApi {
  private client: AxiosInstance;
  private baseUrl: string;

  constructor() {
    const apiKey = config.get("apiKey") as string | undefined;
    this.baseUrl =
      (config.get("baseUrl") as string) || "https://api.buttondown.email/v1";

    if (!apiKey) {
      throw new Error("API key not configured. Run `buttondown login` first.");
    }

    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "application/json",
      },
    });
  }

  static configure(options: ButtondownConfig): void {
    if (options.apiKey) {
      config.set("apiKey", options.apiKey);
    }
    if (options.baseUrl) {
      config.set("baseUrl", options.baseUrl);
    }
  }

  static isConfigured(): boolean {
    return Boolean(config.get("apiKey"));
  }

  static clearConfig(): void {
    config.clear();
  }

  // Email methods
  async getEmails(
    page = 1,
    pageSize = 25
  ): Promise<{ results: Email[]; count: number }> {
    const response = await this.client.get("/emails", {
      params: { page, page_size: pageSize },
    });
    return response.data;
  }

  async getEmail(id: string): Promise<Email> {
    const response = await this.client.get(`/emails/${id}`);
    return response.data;
  }

  async createEmail(emailData: Partial<Email>): Promise<Email> {
    const response = await this.client.post("/emails", emailData);
    return response.data;
  }

  async updateEmail(id: string, emailData: Partial<Email>): Promise<Email> {
    const response = await this.client.patch(`/emails/${id}`, emailData);
    return response.data;
  }

  // Newsletter methods
  async getNewsletter(): Promise<Newsletter> {
    const response = await this.client.get("/newsletters");
    if (
      Array.isArray(response.data.results) &&
      response.data.results.length > 0
    ) {
      return response.data.results[0];
    }
    return response.data;
  }

  async updateNewsletter(
    newsletterData: Partial<Newsletter>
  ): Promise<Newsletter> {
    const newsletter = await this.getNewsletter();
    const response = await this.client.patch(
      `/newsletters/${newsletter.id}`,
      newsletterData
    );
    return response.data;
  }

  // Image methods
  async getImages(
    page = 1,
    pageSize = 25
  ): Promise<{ results: Image[]; count: number }> {
    const response = await this.client.get("/images", {
      params: { page, page_size: pageSize },
    });
    return response.data;
  }

  async getImage(id: string): Promise<Image> {
    const response = await this.client.get(`/images/${id}`);
    return response.data;
  }

  async uploadImage(file: Buffer, filename: string): Promise<Image> {
    const formData = new FormData();
    formData.append("file", new Blob([file]), filename);

    const response = await this.client.post("/images", formData, {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    });

    return response.data;
  }

  async deleteImage(id: string): Promise<void> {
    await this.client.delete(`/images/${id}`);
  }

  // Attachment methods - kept for backward compatibility
  async uploadAttachment(file: Buffer, filename: string): Promise<string> {
    const formData = new FormData();
    formData.append("file", new Blob([file]), filename);

    const response = await this.client.post("/attachments/", formData, {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    });

    return response.data.id;
  }
}
