import Conf from "conf";

export type Config = {
	apiKey?: string;
	baseUrl?: string;
	accessToken?: string;
	refreshToken?: string;
	tokenExpiresAt?: number;
	username?: string;
};

export const createConfig = () => {
	return new Conf<Config>({
		projectName: "buttondown-cli",
	});
};

export default createConfig;
