#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import axios from 'axios';
import { z } from 'zod';
// Define the base URL for the Morpho API
const MORPHO_API_BASE = 'https://blue-api.morpho.org/graphql';
// Helper function to transform string numbers to numbers
const stringToNumber = (val) => {
    if (val === null)
        return 0;
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
            pageInfo: z.object({
                count: z.number(),
                countTotal: z.number(),
            }),
            items: z.array(AssetWithPriceSchema)
        })
    })
});
// Market Positions Response Schema
const MarketPositionsResponseSchema = z.object({
    data: z.object({
        marketPositions: z.object({
            pageInfo: z.object({
                count: z.number(),
                countTotal: z.number(),
            }),
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
// Add PageInfo schema
const PageInfoSchema = z.object({
    count: z.number(),
    countTotal: z.number(),
});
// Update response schemas to include pagination info
const MarketsResponseSchema = z.object({
    data: z.object({
        markets: z.object({
            pageInfo: PageInfoSchema,
            items: z.array(MarketSchema),
        })
    })
});
// TimeseriesPoint Schema
const TimeseriesPointSchema = z.object({
    x: z.number(),
    y: z.number().nullable(),
});
// Oracle Feed Schema
const OracleFeedSchema = z.object({
    address: z.string(),
    description: z.string(),
    vendor: z.string(),
    pair: z.string(),
});
// Oracle Data Schema
const OracleDataSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('MorphoChainlinkOracle'),
        baseFeedOne: OracleFeedSchema,
        vault: z.string(),
    }),
    z.object({
        type: z.literal('MorphoChainlinkOracleV2'),
        baseFeedOne: OracleFeedSchema,
    }),
]);
// Oracle Schema
const OracleSchema = z.object({
    address: z.string(),
    type: z.string(),
    data: OracleDataSchema,
});
// Transaction Schema
const TransactionSchema = z.object({
    blockNumber: z.number(),
    hash: z.string(),
    type: z.string(),
    timestamp: z.number(),
    user: z.object({
        address: z.string(),
    }),
    data: z.object({
        seizedAssets: z.union([z.string(), z.number()]).transform(stringToNumber).optional(),
        repaidAssets: z.union([z.string(), z.number()]).transform(stringToNumber).optional(),
        seizedAssetsUsd: z.union([z.string(), z.number()]).transform(stringToNumber).optional(),
        repaidAssetsUsd: z.union([z.string(), z.number()]).transform(stringToNumber).optional(),
        badDebtAssetsUsd: z.union([z.string(), z.number()]).transform(stringToNumber).optional(),
        liquidator: z.string().optional(),
        market: z.object({
            uniqueKey: z.string(),
        }).optional(),
    }).optional(),
});
// Vault Position Schema
const VaultPositionSchema = z.object({
    vault: z.object({
        address: z.string(),
        name: z.string(),
    }),
    assets: z.union([z.string(), z.number()]).transform(stringToNumber),
    assetsUsd: z.union([z.string(), z.number()]).transform(stringToNumber),
    shares: z.union([z.string(), z.number()]).transform(stringToNumber),
});
// Account Overview Schema
const AccountOverviewSchema = z.object({
    address: z.string(),
    marketPositions: z.array(MarketPositionSchema),
    vaultPositions: z.array(VaultPositionSchema),
    transactions: z.array(TransactionSchema),
});
// Response Schemas
const HistoricalApyResponseSchema = z.object({
    data: z.object({
        marketByUniqueKey: z.object({
            uniqueKey: z.string(),
            historicalState: z.object({
                supplyApy: z.array(TimeseriesPointSchema),
                borrowApy: z.array(TimeseriesPointSchema),
            }),
        }),
    }),
});
const OracleDetailsResponseSchema = z.object({
    data: z.object({
        marketByUniqueKey: z.object({
            oracle: OracleSchema,
        }),
    }),
});
const AccountOverviewResponseSchema = z.object({
    data: z.object({
        userByAddress: AccountOverviewSchema,
    }),
});
const LiquidationsResponseSchema = z.object({
    data: z.object({
        transactions: z.object({
            pageInfo: PageInfoSchema,
            items: z.array(TransactionSchema),
        }),
    }),
});
// Additional tool constants
const GET_HISTORICAL_APY_TOOL = 'get_historical_apy';
const GET_ORACLE_DETAILS_TOOL = 'get_oracle_details';
const GET_ACCOUNT_OVERVIEW_TOOL = 'get_account_overview';
const GET_LIQUIDATIONS_TOOL = 'get_liquidations';
// Create server instance with capabilities to handle tools
const server = new Server({
    name: "morpho-api-server",
    version: "1.0.0"
}, {
    capabilities: {
        tools: {}
    }
});
// Implementation for listing available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: GET_MARKETS_TOOL,
                description: 'Retrieves markets from Morpho with pagination, ordering, and filtering support.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        first: {
                            type: 'number',
                            description: 'Number of items to return (default: 100)'
                        },
                        skip: {
                            type: 'number',
                            description: 'Number of items to skip'
                        },
                        orderBy: {
                            type: 'string',
                            enum: ['Lltv', 'BorrowApy', 'SupplyApy', 'BorrowAssets', 'SupplyAssets', 'BorrowAssetsUsd', 'SupplyAssetsUsd', 'Fee', 'Utilization'],
                            description: 'Field to order by'
                        },
                        orderDirection: {
                            type: 'string',
                            enum: ['Asc', 'Desc'],
                            description: 'Order direction'
                        },
                        where: {
                            type: 'object',
                            properties: {
                                whitelisted: { type: 'boolean' },
                                collateralAssetAddress: { type: 'string' },
                                loanAssetAddress: { type: 'string' },
                                uniqueKey_in: {
                                    type: 'array',
                                    items: { type: 'string' }
                                }
                            }
                        }
                    }
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
                        },
                        chainId: {
                            type: 'number',
                            description: 'Chain ID (default: 1 for Ethereum)'
                        },
                        first: {
                            type: 'number',
                            description: 'Number of items to return'
                        },
                        skip: {
                            type: 'number',
                            description: 'Number of items to skip'
                        }
                    },
                    required: ['symbol']
                },
            },
            {
                name: GET_MARKET_POSITIONS_TOOL,
                description: 'Get positions overview for specific markets with pagination and ordering.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        marketUniqueKey: {
                            type: 'string',
                            description: 'Unique key of the market'
                        },
                        first: {
                            type: 'number',
                            description: 'Number of positions to return (default: 30)'
                        },
                        skip: {
                            type: 'number',
                            description: 'Number of positions to skip'
                        },
                        orderBy: {
                            type: 'string',
                            enum: ['SupplyShares', 'BorrowShares', 'SupplyAssets', 'BorrowAssets'],
                            description: 'Field to order by'
                        },
                        orderDirection: {
                            type: 'string',
                            enum: ['Asc', 'Desc'],
                            description: 'Order direction'
                        }
                    },
                    required: ['marketUniqueKey']
                },
            },
            {
                name: GET_HISTORICAL_APY_TOOL,
                description: 'Get historical APY data for a specific market.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        marketUniqueKey: { type: 'string' },
                        chainId: { type: 'number' },
                        startTimestamp: { type: 'number' },
                        endTimestamp: { type: 'number' },
                        interval: {
                            type: 'string',
                            enum: ['HOUR', 'DAY', 'WEEK', 'MONTH']
                        }
                    },
                    required: ['marketUniqueKey', 'startTimestamp', 'endTimestamp', 'interval']
                },
            },
            {
                name: GET_ORACLE_DETAILS_TOOL,
                description: 'Get oracle details for a specific market.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        marketUniqueKey: { type: 'string' },
                        chainId: { type: 'number' }
                    },
                    required: ['marketUniqueKey']
                },
            },
            {
                name: GET_ACCOUNT_OVERVIEW_TOOL,
                description: 'Get account overview including positions and transactions.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        address: { type: 'string' },
                        chainId: { type: 'number' }
                    },
                    required: ['address']
                },
            },
            {
                name: GET_LIQUIDATIONS_TOOL,
                description: 'Get liquidation events with filtering and pagination.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        marketUniqueKeys: {
                            type: 'array',
                            items: { type: 'string' }
                        },
                        startTimestamp: { type: 'number' },
                        endTimestamp: { type: 'number' },
                        first: { type: 'number' },
                        skip: { type: 'number' },
                        orderBy: {
                            type: 'string',
                            enum: ['Timestamp', 'SeizedAssetsUsd', 'RepaidAssetsUsd']
                        },
                        orderDirection: {
                            type: 'string',
                            enum: ['Asc', 'Desc']
                        }
                    }
                },
            },
        ],
    };
});
// Helper function to build GraphQL query parameters
function buildQueryParams(params) {
    const queryParts = [];
    if (params.first !== undefined)
        queryParts.push(`first: ${params.first}`);
    if (params.skip !== undefined)
        queryParts.push(`skip: ${params.skip}`);
    if (params.orderBy)
        queryParts.push(`orderBy: ${params.orderBy}`);
    if (params.orderDirection)
        queryParts.push(`orderDirection: ${params.orderDirection}`);
    if (params.where && Object.keys(params.where).length > 0) {
        const whereStr = JSON.stringify(params.where).replace(/"([^"]+)":/g, '$1:');
        queryParts.push(`where: ${whereStr}`);
    }
    return queryParts.length > 0 ? `(${queryParts.join(', ')})` : '';
}
// Implementation to handle tool execution requests
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, params } = request.params;
    if (name === GET_MARKETS_TOOL) {
        try {
            const queryParams = buildQueryParams(params);
            const query = `
            query {
              markets${queryParams} {
                pageInfo {
                  count
                  countTotal
                }
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
            const validatedData = MarketsResponseSchema.parse(response.data);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(validatedData.data.markets, null, 2),
                    },
                ],
            };
        }
        catch (error) {
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
        }
        catch (error) {
            console.error('Error calling Morpho API:', error.message);
            return {
                isError: true,
                content: [{ type: 'text', text: `Error retrieving whitelisted markets: ${error.message}` }],
            };
        }
    }
    if (name === GET_ASSET_PRICE_TOOL) {
        try {
            const { symbol, chainId = 1, ...paginationParams } = params;
            const queryParams = buildQueryParams({
                ...paginationParams,
                where: { symbol_in: [symbol], chainId }
            });
            const query = `
            query {
              assets${queryParams} {
                pageInfo {
                  count
                  countTotal
                }
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
                        text: JSON.stringify(validatedData.data.assets, null, 2),
                    },
                ],
            };
        }
        catch (error) {
            console.error('Error calling Morpho API:', error.message);
            return {
                isError: true,
                content: [{ type: 'text', text: `Error retrieving asset price: ${error.message}` }],
            };
        }
    }
    if (name === GET_MARKET_POSITIONS_TOOL) {
        try {
            const { marketUniqueKey, ...queryParams } = params;
            const finalParams = buildQueryParams({
                ...queryParams,
                where: { marketUniqueKey_in: [marketUniqueKey] }
            });
            const query = `
            query {
              marketPositions${finalParams} {
                pageInfo {
                  count
                  countTotal
                }
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
                        text: JSON.stringify(validatedData.data.marketPositions, null, 2),
                    },
                ],
            };
        }
        catch (error) {
            console.error('Error calling Morpho API:', error.message);
            return {
                isError: true,
                content: [{ type: 'text', text: `Error retrieving market positions: ${error.message}` }],
            };
        }
    }
    if (name === GET_HISTORICAL_APY_TOOL) {
        try {
            const { marketUniqueKey, chainId = 1, startTimestamp, endTimestamp, interval } = params;
            const query = `
            query MarketApys {
              marketByUniqueKey(
                uniqueKey: "${marketUniqueKey}"
                chainId: ${chainId}
              ) {
                uniqueKey
                historicalState {
                  supplyApy(options: {
                    startTimestamp: ${startTimestamp}
                    endTimestamp: ${endTimestamp}
                    interval: ${interval}
                  }) {
                    x
                    y
                  }
                  borrowApy(options: {
                    startTimestamp: ${startTimestamp}
                    endTimestamp: ${endTimestamp}
                    interval: ${interval}
                  }) {
                    x
                    y
                  }
                }
              }
            }`;
            const response = await axios.post(MORPHO_API_BASE, { query });
            const validatedData = HistoricalApyResponseSchema.parse(response.data);
            return {
                content: [{ type: 'text', text: JSON.stringify(validatedData.data.marketByUniqueKey, null, 2) }],
            };
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: 'text', text: `Error retrieving historical APY: ${error.message}` }],
            };
        }
    }
    if (name === GET_ORACLE_DETAILS_TOOL) {
        try {
            const { marketUniqueKey, chainId = 1 } = params;
            const query = `
            query {
              marketByUniqueKey(
                uniqueKey: "${marketUniqueKey}"
                chainId: ${chainId}
              ) {
                oracle {
                  address
                  type
                  data {
                    ... on MorphoChainlinkOracleData {
                      baseFeedOne {
                        address
                        description
                        vendor
                        pair
                      }
                      vault
                    }
                    ... on MorphoChainlinkOracleV2Data {
                      baseFeedOne {
                        address
                        description
                        vendor
                        pair
                      }
                    }
                  }
                }
              }
            }`;
            const response = await axios.post(MORPHO_API_BASE, { query });
            const validatedData = OracleDetailsResponseSchema.parse(response.data);
            return {
                content: [{ type: 'text', text: JSON.stringify(validatedData.data.marketByUniqueKey, null, 2) }],
            };
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: 'text', text: `Error retrieving oracle details: ${error.message}` }],
            };
        }
    }
    if (name === GET_ACCOUNT_OVERVIEW_TOOL) {
        try {
            const { address, chainId = 1 } = params;
            const query = `
            query {
              userByAddress(
                chainId: ${chainId}
                address: "${address}"
              ) {
                address
                marketPositions {
                  market {
                    uniqueKey
                  }
                  borrowAssets
                  borrowAssetsUsd
                  supplyAssets
                  supplyAssetsUsd
                }
                vaultPositions {
                  vault {
                    address
                    name
                  }
                  assets
                  assetsUsd
                  shares
                }
                transactions {
                  hash
                  timestamp
                  type
                }
              }
            }`;
            const response = await axios.post(MORPHO_API_BASE, { query });
            const validatedData = AccountOverviewResponseSchema.parse(response.data);
            return {
                content: [{ type: 'text', text: JSON.stringify(validatedData.data.userByAddress, null, 2) }],
            };
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: 'text', text: `Error retrieving account overview: ${error.message}` }],
            };
        }
    }
    if (name === GET_LIQUIDATIONS_TOOL) {
        try {
            const liquidationParams = params;
            const where = {
                type_in: ['MarketLiquidation']
            };
            if (liquidationParams.marketUniqueKeys?.length) {
                where.marketUniqueKey_in = liquidationParams.marketUniqueKeys;
            }
            if (liquidationParams.startTimestamp) {
                where.timestamp_gte = liquidationParams.startTimestamp;
            }
            if (liquidationParams.endTimestamp) {
                where.timestamp_lte = liquidationParams.endTimestamp;
            }
            const queryParams = buildQueryParams({
                first: liquidationParams.first,
                skip: liquidationParams.skip,
                orderBy: liquidationParams.orderBy,
                orderDirection: liquidationParams.orderDirection,
                where
            });
            const query = `
            query {
              transactions${queryParams} {
                pageInfo {
                  count
                  countTotal
                }
                items {
                  blockNumber
                  hash
                  type
                  timestamp
                  user {
                    address
                  }
                  data {
                    ... on MarketLiquidationTransactionData {
                      seizedAssets
                      repaidAssets
                      seizedAssetsUsd
                      repaidAssetsUsd
                      badDebtAssetsUsd
                      liquidator
                      market {
                        uniqueKey
                      }
                    }
                  }
                }
              }
            }`;
            const response = await axios.post(MORPHO_API_BASE, { query });
            const validatedData = LiquidationsResponseSchema.parse(response.data);
            return {
                content: [{ type: 'text', text: JSON.stringify(validatedData.data.transactions, null, 2) }],
            };
        }
        catch (error) {
            return {
                isError: true,
                content: [{ type: 'text', text: `Error retrieving liquidations: ${error.message}` }],
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
