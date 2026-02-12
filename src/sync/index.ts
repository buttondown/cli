import { AUTOMATIONS_RESOURCE } from "./automations.js";
import { EMAILS_RESOURCE } from "./emails.js";
import { IMAGES_RESOURCE } from "./images.js";
import { NEWSLETTER_RESOURCE } from "./newsletter.js";
import { SNIPPETS_RESOURCE } from "./snippets.js";

export {
	AUTOMATIONS_RESOURCE,
	LOCAL_AUTOMATIONS_RESOURCE,
	REMOTE_AUTOMATIONS_RESOURCE,
} from "./automations.js";
export {
	convertAbsoluteToRelativeImages,
	EMAILS_RESOURCE,
	findRelativeImageReferences,
	LOCAL_EMAILS_RESOURCE,
	REMOTE_EMAILS_RESOURCE,
	replaceImageReference,
	resolveRelativeImageReferences,
} from "./emails.js";
export {
	IMAGES_RESOURCE,
	LOCAL_IMAGES_RESOURCE,
	REMOTE_IMAGES_RESOURCE,
	uploadImage,
} from "./images.js";
export {
	LOCAL_NEWSLETTER_RESOURCE,
	NEWSLETTER_RESOURCE,
	REMOTE_NEWSLETTER_RESOURCE,
} from "./newsletter.js";
export {
	LOCAL_SNIPPETS_RESOURCE,
	REMOTE_SNIPPETS_RESOURCE,
	SNIPPETS_RESOURCE,
} from "./snippets.js";
export { readSyncState, writeSyncState } from "./state.js";
export type { Configuration, Resource } from "./types.js";

/** Resources that don't need special image/email handling */
export const BASE_RESOURCES = [
	AUTOMATIONS_RESOURCE,
	NEWSLETTER_RESOURCE,
	SNIPPETS_RESOURCE,
];

export const RESOURCES = [
	AUTOMATIONS_RESOURCE,
	EMAILS_RESOURCE,
	IMAGES_RESOURCE,
	NEWSLETTER_RESOURCE,
	SNIPPETS_RESOURCE,
];
