import { AUTOMATIONS_RESOURCE } from "./automations.js";
import { EMAILS_RESOURCE } from "./emails.js";
import { IMAGES_RESOURCE } from "./images.js";
import { NEWSLETTER_RESOURCE } from "./newsletter.js";

export {
	AUTOMATIONS_RESOURCE,
	LOCAL_AUTOMATIONS_RESOURCE,
	REMOTE_AUTOMATIONS_RESOURCE,
} from "./automations.js";
export {
	EMAILS_RESOURCE,
	findRelativeImageReferences,
	LOCAL_EMAILS_RESOURCE,
	REMOTE_EMAILS_RESOURCE,
} from "./emails.js";
export {
	IMAGES_RESOURCE,
	LOCAL_IMAGES_RESOURCE,
	REMOTE_IMAGES_RESOURCE,
} from "./images.js";
export {
	LOCAL_NEWSLETTER_RESOURCE,
	NEWSLETTER_RESOURCE,
	REMOTE_NEWSLETTER_RESOURCE,
} from "./newsletter.js";
export type { Configuration, Resource } from "./types.js";

export const RESOURCES = [
	AUTOMATIONS_RESOURCE,
	EMAILS_RESOURCE,
	IMAGES_RESOURCE,
	NEWSLETTER_RESOURCE,
];
