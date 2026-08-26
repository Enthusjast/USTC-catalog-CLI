import packageJson from "../package.json" with { type: "json" };

export const CLI_DISPLAY_NAME = "USTC-catalog-CLI";
export const CLI_VERSION = packageJson.version;
export const CLI_VERSION_TEXT = `${CLI_DISPLAY_NAME} ${CLI_VERSION}`;
