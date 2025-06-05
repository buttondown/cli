import Conf from "conf";

export type Config = {
  apiKey?: string;
  baseUrl?: string;
};

const createConfig = () => {
  return new Conf<Config>({
    projectName: "buttondown-cli",
  });
};

export default createConfig;
