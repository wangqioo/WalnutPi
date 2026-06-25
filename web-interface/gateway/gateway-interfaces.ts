export type JsonObject = Record<string, any>;

export type GatewayResponse = {
  body: JsonObject;
  status: number;
};

export type GatewayJson = (data: JsonObject, status?: number) => Response;

