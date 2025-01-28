#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import axios from 'axios';
import { z } from 'zod';

// Define the base URL for the Morpho API
const MORPHO_API_BASE = 'https://blue-api.morpho.org/graphql';

// Helper function to transform string numbers to numbers
const stringToNumber = (val: string | number | null): number => {
  if (val === null) return 0;
  return typeof val === 'string' ? Number(val) : val;
};

// Define Zod schemas for data validation

// Asset Schema
const AssetSchema = z.object({
  address: z.string(),
  symbol: z.string(),
  decimals: z.number(),
}).nullable().transform(val => val || {
  address: '',
  symbol: '',
  decimals: 0
});

// Chain Schema
const ChainSchema = z.object({
  id: z.number(),
  network: z.string(),
  currency: z.string()
});

// Yield Schema
const YieldSchema = z.object({
  apr: z.number().nullable()
});

// Asset with Price Schema
const AssetWithPriceSchema = z.object({
  symbol: z.string(),
  address: z.string(),
  priceUsd: z.number().nullable(),
  chain: ChainSchema,
  yield: YieldSchema.nullable()
});

// Market Position Schema
const MarketPositionSchema = z.object({
  supplyShares: z.union([z.string(), z.number()]).transform(stringToNumber).optional(),
  supplyAssets: z.union([z.string(), z.number()]).transform(stringToNumber),
  supplyAssetsUsd: z.union([z.string(), z.number()]).transform(stringToNumber),
  borrowShares: z.union([z.string(), z.number()]).transform(stringToNumber).optional(),
  borrowAssets: z.union([z.string(), z.number()]).transform(stringToNumber),
  borrowAssetsUsd: z.union([z.string(), z.number()]).transform(stringToNumber),
  collateral: z.union([z.string(), z.number()]).transform(stringToNumber).optional(),
  collateralUsd: z.union([z.string(), z.number()]).transform(stringToNumber).optional(),
  market: z.object({
    uniqueKey: z.string(),
    loanAsset: AssetSchema,
    collateralAsset: AssetSchema,
  }),
  user: z.object({
    address: z.string()
  })
});

// Market Schema
const MarketSchema = z.object({
  uniqueKey: z.string(),
  lltv: z.union([z.string(), z.number()]).transform(stringToNumber),
  oracleAddress: z.string(),
  irmAddress: z.string(),
  whitelisted: z.boolean().optional(),
  loanAsset: AssetSchema,
  collateralAsset: AssetSchema,
  state: z.object({
    borrowApy: z.number(),
    borrowAssets: z.union([z.string(), z.number()]).transform(stringToNumber),
    borrowAssetsUsd: z.number().nullable().transform(val => val ?? 0),
    supplyApy: z.number(),
    supplyAssets: z.union([z.string(), z.number()]).transform(stringToNumber),
    supplyAssetsUsd: z.number().nullable().transform(val => val ?? 0),
    fee: z.number(),
    utilization: z.number(),
  }),
});

// Combined items schema
const MarketsItemsSchema = z.object({
  items: z.array(MarketSchema),
});

// Assets Response Schema
const AssetsResponseSchema = z.object({
  data: z.object({
    assets: z.object({
      items: z.array(AssetWithPriceSchema)
    })
  })
});

// Market Positions Response Schema
const MarketPositionsResponseSchema = z.object({
  data: z.object({
    marketPositions: z.object({
      items: z.array(MarketPositionSchema)
    })
  })
});

// Morpho API Response Schema
const MorphoApiResponseSchema = z.object({
  data: z.object({
        markets: MarketsItemsSchema
    })
});

// Define tool names as constants to avoid typos
const GET_MARKETS_TOOL = 'get_markets';
const GET_WHITELISTED_MARKETS_TOOL = 'get_whitelisted_markets';
const GET_ASSET_PRICE_TOOL = 'get_asset_price';
const GET_MARKET_POSITIONS_TOOL = 'get_market_positions';

// Define parameter types for tools
type AssetPriceParams = {
  symbol: string;
};

type MarketPositionsParams = {
  marketUniqueKey: string;
  limit?: number;
};

// Create server instance with capabilities to handle tools
const server = new Server(
    {
        name: "morpho-api-server",
        version: "1.0.0"
    },
    {
        capabilities: {
          tools: {}
        }
    }
);

// Implementation for listing available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: GET_MARKETS_TOOL,
        description: 'Retrieves all available markets from Morpho.',
        inputSchema: {
          type: 'object',
          properties: {}, // No input parameters for this tool
        },
      },
      {
        name: GET_WHITELISTED_MARKETS_TOOL,
        description: 'Retrieves only whitelisted markets from Morpho.',
        inputSchema: {
          type: 'object',
          properties: {}, // No input parameters for this tool
        },
      },
      {
        name: GET_ASSET_PRICE_TOOL,
        description: 'Get current price and yield information for specific assets.',
        inputSchema: {
          type: 'object',
          properties: {
            symbol: {
              type: 'string',
              description: 'Asset symbol (e.g. "sDAI")'
            }
          },
          required: ['symbol']
        },
      },
      {
        name: GET_MARKET_POSITIONS_TOOL,
        description: 'Get positions overview for specific markets.',
        inputSchema: {
          type: 'object',
          properties: {
            marketUniqueKey: {
              type: 'string',
              description: 'Unique key of the market'
            },
            limit: {
              type: 'number',
              description: 'Number of positions to return (default: 30)'
            }
          },
          required: ['marketUniqueKey']
        },
      },
    ],
  };
});

// Implementation to handle tool execution requests
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, params } = request.params;

  if (name === GET_MARKETS_TOOL) {
      try {
            const query = `
            query {
              markets {
                items {
                  uniqueKey
                  lltv
                  oracleAddress
                  irmAddress
                  loanAsset {
                    address
                    symbol
                    decimals
                  }
                  collateralAsset {
                    address
                    symbol
                    decimals
                  }
                  state {
                    borrowApy
                    borrowAssets
                    borrowAssetsUsd
                    supplyApy
                    supplyAssets
                    supplyAssetsUsd
                    fee
                    utilization
                  }
                }
              }
            }
          `;

            const response = await axios.post(MORPHO_API_BASE, { query });
            const validatedData = MorphoApiResponseSchema.parse(response.data);

            return {
              content: [
                {
                    type: 'text',
                    text: JSON.stringify(validatedData.data.markets.items, null, 2),
                },
              ],
            };
      } catch (error: any) {
        console.error('Error calling Morpho API:', error.message);
        return {
          isError: true,
          content: [{ type: 'text', text: `Error retrieving markets: ${error.message}` }],
        };
      }
  }

  if (name === GET_WHITELISTED_MARKETS_TOOL) {
      try {
            const query = `
            query {
              markets(where:{whitelisted: true}) {
                items {
                  whitelisted
                  uniqueKey
                  lltv
                  oracleAddress
                  irmAddress
                  loanAsset {
                    address
                    symbol
                    decimals
                  }
                  collateralAsset {
                    address
                    symbol
                    decimals
                  }
                  state {
                    borrowApy
                    borrowAssets
                    borrowAssetsUsd
                    supplyApy
                    supplyAssets
                    supplyAssetsUsd
                    fee
                    utilization
                  }
                }
              }
            }
          `;

            const response = await axios.post(MORPHO_API_BASE, { query });
            const validatedData = MorphoApiResponseSchema.parse(response.data);

            return {
              content: [
                {
                    type: 'text',
                    text: JSON.stringify(validatedData.data.markets.items, null, 2),
                },
              ],
            };
      } catch (error: any) {
        console.error('Error calling Morpho API:', error.message);
        return {
          isError: true,
          content: [{ type: 'text', text: `Error retrieving whitelisted markets: ${error.message}` }],
        };
      }
  }

  if (name === GET_ASSET_PRICE_TOOL) {
      try {
            const { symbol } = params as AssetPriceParams;
            const query = `
            query GetAssetsWithPrice {
              assets(where: { symbol_in: ["${symbol}"] }) {
                items {
                  symbol
                  address
                  priceUsd
                  chain {
                    id
                    network
                    currency
                  }
                  yield {
                    apr
                  }
                }
              }
            }
          `;

            const response = await axios.post(MORPHO_API_BASE, { query });
            const validatedData = AssetsResponseSchema.parse(response.data);

            return {
              content: [
                {
                    type: 'text',
                    text: JSON.stringify(validatedData.data.assets.items, null, 2),
                },
              ],
            };
      } catch (error: any) {
        console.error('Error calling Morpho API:', error.message);
        return {
          isError: true,
          content: [{ type: 'text', text: `Error retrieving asset price: ${error.message}` }],
        };
      }
  }

  if (name === GET_MARKET_POSITIONS_TOOL) {
      try {
            const { marketUniqueKey, limit = 30 } = params as MarketPositionsParams;
            const query = `
            query {
              marketPositions(
                first: ${limit}
                orderBy: SupplyShares
                orderDirection: Desc
                where: {
                  marketUniqueKey_in: ["${marketUniqueKey}"]
                }
              ) {
                items {
                  supplyShares
                  supplyAssets
                  supplyAssetsUsd
                  borrowShares
                  borrowAssets
                  borrowAssetsUsd
                  collateral
                  collateralUsd
                  market {
                    uniqueKey
                    loanAsset {
                      address
                      symbol
                    }
                    collateralAsset {
                      address
                      symbol
                    }
                  }
                  user {
                    address
                  }
                }
              }
            }
          `;

            const response = await axios.post(MORPHO_API_BASE, { query });
            const validatedData = MarketPositionsResponseSchema.parse(response.data);

            return {
              content: [
                {
                    type: 'text',
                    text: JSON.stringify(validatedData.data.marketPositions.items, null, 2),
                },
              ],
            };
      } catch (error: any) {
        console.error('Error calling Morpho API:', error.message);
        return {
          isError: true,
          content: [{ type: 'text', text: `Error retrieving market positions: ${error.message}` }],
        };
      }
  }

  // Tool not found
  throw new Error(`Tool not found: ${name}`);

});

// Set up the transport for the server
const transport = new StdioServerTransport();

// Start the server
async function main() {
    await server.connect(transport);
    console.error("Morpho API MCP Server running on stdio");
}

main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
}); 