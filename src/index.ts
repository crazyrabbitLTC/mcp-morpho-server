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

// Define parameter types for tools
type PaginationParams = {
  first?: number;
  skip?: number;
};

type OrderDirection = 'Asc' | 'Desc';

type MarketOrderField = 
  | 'Lltv'
  | 'BorrowApy'
  | 'SupplyApy'
  | 'BorrowAssets'
  | 'SupplyAssets'
  | 'BorrowAssetsUsd'
  | 'SupplyAssetsUsd'
  | 'Fee'
  | 'Utilization';

type MarketFilterParams = {
  whitelisted?: boolean;
  collateralAssetAddress?: string;
  loanAssetAddress?: string;
  uniqueKey_in?: string[];
};

type MarketQueryParams = PaginationParams & {
  orderBy?: MarketOrderField;
  orderDirection?: OrderDirection;
  where?: MarketFilterParams;
};

type AssetPriceParams = PaginationParams & {
  symbol: string;
  chainId?: number;
};

type MarketPositionsParams = PaginationParams & {
  marketUniqueKey: string;
  orderBy?: 'SupplyShares' | 'BorrowShares' | 'SupplyAssets' | 'BorrowAssets';
  orderDirection?: OrderDirection;
};

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

// Additional parameter types
type TimeseriesInterval = 'HOUR' | 'DAY' | 'WEEK' | 'MONTH';

type TimeseriesParams = {
  startTimestamp: number;
  endTimestamp: number;
  interval: TimeseriesInterval;
};

type HistoricalApyParams = {
  marketUniqueKey: string;
  chainId?: number;
} & TimeseriesParams;

type OracleDetailsParams = {
  marketUniqueKey: string;
  chainId?: number;
};

type AccountOverviewParams = {
  address: string;
  chainId?: number;
};

type LiquidationsParams = PaginationParams & {
  marketUniqueKeys?: string[];
  startTimestamp?: number;
  endTimestamp?: number;
  orderBy?: 'Timestamp' | 'SeizedAssetsUsd' | 'RepaidAssetsUsd';
  orderDirection?: OrderDirection;
};

// Warning Schema
const WarningSchema = z.object({
  type: z.enum(['unrecognized_deposit_asset', 'unrecognized_vault_curator', 'not_whitelisted']),
  level: z.enum(['YELLOW', 'RED'])
});

// Flow Cap Schema
const FlowCapSchema = z.object({
  market: z.object({
    uniqueKey: z.string()
  }),
  maxIn: z.union([z.string(), z.number()]).transform(stringToNumber),
  maxOut: z.union([z.string(), z.number()]).transform(stringToNumber)
});

// Public Allocator Config Schema
const PublicAllocatorConfigSchema = z.object({
  fee: z.number(),
  flowCaps: z.array(FlowCapSchema)
});

// Pending Cap Schema
const PendingCapSchema = z.object({
  validAt: z.number(),
  supplyCap: z.union([z.string(), z.number()]).transform(stringToNumber),
  market: z.object({
    uniqueKey: z.string()
  })
});

// Update VaultSchema
const VaultSchema = z.object({
  address: z.string(),
  symbol: z.string(),
  name: z.string(),
  creationBlockNumber: z.number(),
  creationTimestamp: z.number(),
  creatorAddress: z.string(),
  whitelisted: z.boolean(),
  asset: z.object({
    id: z.string(),
    address: z.string(),
    decimals: z.number()
  }),
  chain: z.object({
    id: z.number(),
    network: z.string()
  }),
  state: z.object({
    id: z.string(),
    apy: z.number().nullable(),
    netApy: z.number().nullable(),
    totalAssets: z.union([z.string(), z.number()]).transform(stringToNumber),
    totalAssetsUsd: z.union([z.string(), z.number()]).transform(stringToNumber),
    fee: z.number(),
    timelock: z.number()
  }),
  warnings: z.array(WarningSchema).optional(),
  pendingCaps: z.array(PendingCapSchema).optional(),
  allocators: z.array(z.object({
    address: z.string()
  })).optional(),
  publicAllocatorConfig: PublicAllocatorConfigSchema.optional()
});

// Vault Allocation Schema
const VaultAllocationSchema = z.object({
  market: MarketSchema,
  supplyCap: z.union([z.string(), z.number()]).transform(stringToNumber),
  supplyAssets: z.union([z.string(), z.number()]).transform(stringToNumber),
  supplyAssetsUsd: z.union([z.string(), z.number()]).transform(stringToNumber)
});

// Vault Reallocate Schema
const VaultReallocateSchema = z.object({
  id: z.string(),
  timestamp: z.number(),
  hash: z.string(),
  blockNumber: z.number(),
  caller: z.string(),
  shares: z.union([z.string(), z.number()]).transform(stringToNumber),
  assets: z.union([z.string(), z.number()]).transform(stringToNumber),
  type: z.string(),
  vault: z.object({
    id: z.string(),
    chain: z.object({
      id: z.number()
    })
  }),
  market: MarketSchema
});

// Update VaultsResponseSchema
const VaultsResponseSchema = z.object({
  data: z.object({
    vaults: z.object({
      pageInfo: PageInfoSchema,
      items: z.array(VaultSchema)
    })
  })
});

// Add new response schemas
const VaultAllocationResponseSchema = z.object({
  data: z.object({
    vaultByAddress: z.object({
      address: z.string(),
      state: z.object({
        allocation: z.array(VaultAllocationSchema)
      })
    })
  })
});

const VaultReallocatesResponseSchema = z.object({
  data: z.object({
    vaultReallocates: z.object({
      items: z.array(VaultReallocateSchema),
      pageInfo: PageInfoSchema
    })
  })
});

// Add new tool constants
const GET_VAULT_ALLOCATION_TOOL = 'get_vault_allocation';
const GET_VAULT_REALLOCATES_TOOL = 'get_vault_reallocates';

// Add new parameter types
type VaultAllocationParams = {
  address: string;
  chainId?: number;
};

type VaultReallocateParams = PaginationParams & {
  vaultAddress: string;
  orderBy?: 'Timestamp';
  orderDirection?: OrderDirection;
};

// Add new tool constants
const GET_VAULTS_TOOL = 'get_vaults';
const GET_VAULT_POSITIONS_TOOL = 'get_vault_positions';
const GET_VAULT_TRANSACTIONS_TOOL = 'get_vault_transactions';
const GET_VAULT_APY_HISTORY_TOOL = 'get_vault_apy_history';

// Add new parameter types
type VaultQueryParams = PaginationParams & {
  orderBy?: 'TotalAssetsUsd' | 'Apy' | 'NetApy';
  orderDirection?: OrderDirection;
  where?: {
    asset_in?: string[];
    address_in?: string[];
  };
};

type VaultPositionsParams = PaginationParams & {
  vaultAddress: string;
  orderBy?: 'Shares' | 'Assets' | 'AssetsUsd';
  orderDirection?: OrderDirection;
};

type VaultTransactionsParams = PaginationParams & {
  orderBy?: 'Timestamp';
  orderDirection?: OrderDirection;
  type_in?: ('MetaMorphoFee' | 'MetaMorphoWithdraw' | 'MetaMorphoDeposit')[];
};

type VaultApyHistoryParams = {
  address: string;
  options: {
    startTimestamp: number;
    endTimestamp: number;
    interval: 'HOUR' | 'DAY' | 'WEEK' | 'MONTH';
  };
};

// Add new response schemas
const VaultPositionsResponseSchema = z.object({
  data: z.object({
    vaultPositions: z.object({
      items: z.array(z.object({
        shares: z.union([z.string(), z.number()]).transform(stringToNumber),
        assets: z.union([z.string(), z.number()]).transform(stringToNumber),
        assetsUsd: z.union([z.string(), z.number()]).transform(stringToNumber),
        user: z.object({
          address: z.string()
        })
      }))
    })
  })
});

const VaultTransactionsResponseSchema = z.object({
  data: z.object({
    transactions: z.object({
      items: z.array(z.object({
        hash: z.string(),
        timestamp: z.number(),
        type: z.string(),
        chain: z.object({
          id: z.number(),
          network: z.string()
        }),
        user: z.object({
          address: z.string()
        }),
        data: z.object({
          shares: z.union([z.string(), z.number()]).transform(stringToNumber).optional(),
          assets: z.union([z.string(), z.number()]).transform(stringToNumber).optional(),
          vault: z.object({
            address: z.string()
          }).optional()
        }).optional()
      }))
    })
  })
});

const VaultApyHistoryResponseSchema = z.object({
  data: z.object({
    vaultByAddress: z.object({
      address: z.string(),
      historicalState: z.object({
        apy: z.array(TimeseriesPointSchema),
        netApy: z.array(TimeseriesPointSchema)
      })
    })
  })
});

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
      {
        name: GET_VAULT_ALLOCATION_TOOL,
        description: 'Get vault allocation for a specific market.',
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
        name: GET_VAULT_REALLOCATES_TOOL,
        description: 'Get vault reallocates for a specific vault.',
        inputSchema: {
          type: 'object',
          properties: {
            vaultAddress: { type: 'string' },
            first: { type: 'number' },
            skip: { type: 'number' },
            orderBy: {
              type: 'string',
              enum: ['Timestamp']
            },
            orderDirection: {
              type: 'string',
              enum: ['Asc', 'Desc']
            }
          },
          required: ['vaultAddress']
        },
      },
      {
        name: GET_VAULTS_TOOL,
        description: 'Retrieves all vaults with their current states.',
        inputSchema: {
          type: 'object',
          properties: {
            first: { type: 'number' },
            skip: { type: 'number' },
            orderBy: {
              type: 'string',
              enum: ['TotalAssetsUsd', 'Apy', 'NetApy']
            },
            orderDirection: {
              type: 'string',
              enum: ['Asc', 'Desc']
            }
          }
        }
      },
      {
        name: GET_VAULT_POSITIONS_TOOL,
        description: 'Get positions for a specific vault.',
        inputSchema: {
          type: 'object',
          properties: {
            vaultAddress: { type: 'string' },
            first: { type: 'number' },
            skip: { type: 'number' },
            orderBy: {
              type: 'string',
              enum: ['Shares', 'Assets', 'AssetsUsd']
            },
            orderDirection: {
              type: 'string',
              enum: ['Asc', 'Desc']
            }
          },
          required: ['vaultAddress']
        }
      },
      {
        name: GET_VAULT_TRANSACTIONS_TOOL,
        description: 'Get latest vault transactions.',
        inputSchema: {
          type: 'object',
          properties: {
            first: { type: 'number' },
            skip: { type: 'number' },
            orderBy: {
              type: 'string',
              enum: ['Timestamp']
            },
            orderDirection: {
              type: 'string',
              enum: ['Asc', 'Desc']
            },
            type_in: {
              type: 'array',
              items: {
                type: 'string',
                enum: ['MetaMorphoFee', 'MetaMorphoWithdraw', 'MetaMorphoDeposit']
              }
            }
          }
        }
      },
      {
        name: GET_VAULT_APY_HISTORY_TOOL,
        description: 'Get historical APY data for a vault.',
        inputSchema: {
          type: 'object',
          properties: {
            address: { type: 'string' },
            options: {
              type: 'object',
              properties: {
                startTimestamp: { type: 'number' },
                endTimestamp: { type: 'number' },
                interval: {
                  type: 'string',
                  enum: ['HOUR', 'DAY', 'WEEK', 'MONTH']
                }
              },
              required: ['startTimestamp', 'endTimestamp', 'interval']
            }
          },
          required: ['address', 'options']
        }
      }
    ],
  };
});

// Helper function to build GraphQL query parameters
function buildQueryParams(params: PaginationParams & { orderBy?: string, orderDirection?: OrderDirection, where?: Record<string, any> } = {}): string {
  const queryParts: string[] = [];
  
  if (params.first !== undefined) queryParts.push(`first: ${params.first}`);
  if (params.skip !== undefined) queryParts.push(`skip: ${params.skip}`);
  if (params.orderBy) queryParts.push(`orderBy: ${params.orderBy}`);
  if (params.orderDirection) queryParts.push(`orderDirection: ${params.orderDirection}`);
  if (params.where && Object.keys(params.where).length > 0) {
    const whereStr = JSON.stringify(params.where).replace(/"([^"]+)":/g, '$1:');
    queryParts.push(`where: ${whereStr}`);
  }

  return queryParts.length > 0 ? `(${queryParts.join(', ')})` : '';
}

// Implementation to handle tool execution requests
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, params = {} } = request.params;

  if (name === GET_MARKETS_TOOL) {
      try {
            const queryParams = buildQueryParams(params as MarketQueryParams);
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
            const { symbol, chainId = 1, ...paginationParams } = params as AssetPriceParams;
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
            const { marketUniqueKey, ...queryParams } = params as MarketPositionsParams;
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
      } catch (error: any) {
        console.error('Error calling Morpho API:', error.message);
        return {
          isError: true,
          content: [{ type: 'text', text: `Error retrieving market positions: ${error.message}` }],
        };
      }
  }

  if (name === GET_HISTORICAL_APY_TOOL) {
      try {
            const { marketUniqueKey, chainId = 1, startTimestamp, endTimestamp, interval } = params as HistoricalApyParams;
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
      } catch (error: any) {
            return {
              isError: true,
              content: [{ type: 'text', text: `Error retrieving historical APY: ${error.message}` }],
            };
      }
  }

  if (name === GET_ORACLE_DETAILS_TOOL) {
      try {
            const { marketUniqueKey, chainId = 1 } = params as OracleDetailsParams;
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
      } catch (error: any) {
            return {
              isError: true,
              content: [{ type: 'text', text: `Error retrieving oracle details: ${error.message}` }],
            };
      }
  }

  if (name === GET_ACCOUNT_OVERVIEW_TOOL) {
      try {
            const { address, chainId = 1 } = params as AccountOverviewParams;
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
      } catch (error: any) {
            return {
              isError: true,
              content: [{ type: 'text', text: `Error retrieving account overview: ${error.message}` }],
            };
      }
  }

  if (name === GET_LIQUIDATIONS_TOOL) {
      try {
            const liquidationParams = params as LiquidationsParams;
            const where: Record<string, any> = {
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
      } catch (error: any) {
            return {
              isError: true,
              content: [{ type: 'text', text: `Error retrieving liquidations: ${error.message}` }],
            };
      }
  }

  if (name === GET_VAULT_ALLOCATION_TOOL) {
      try {
            const { address, chainId = 1 } = params as VaultAllocationParams;
            const query = `
            query {
              vaultByAddress(
                chainId: ${chainId}
                address: "${address}"
              ) {
                address
                state {
                  allocation {
                    market {
                      uniqueKey
                    }
                    supplyCap
                    supplyAssets
                    supplyAssetsUsd
                  }
                }
              }
            }`;

            const response = await axios.post(MORPHO_API_BASE, { query });
            const validatedData = VaultAllocationResponseSchema.parse(response.data);

            return {
              content: [{ type: 'text', text: JSON.stringify(validatedData.data.vaultByAddress, null, 2) }],
            };
      } catch (error: any) {
            return {
              isError: true,
              content: [{ type: 'text', text: `Error retrieving vault allocation: ${error.message}` }],
            };
      }
  }

  if (name === GET_VAULT_REALLOCATES_TOOL) {
      try {
            const { vaultAddress, first, skip, orderBy = 'Timestamp', orderDirection = 'Asc' } = params as VaultReallocateParams;
            const queryParams = buildQueryParams({
              first,
              skip,
              orderBy,
              orderDirection,
              where: { vaultAddress_in: [vaultAddress] }
            });

            const query = `
            query {
              vaultReallocates${queryParams} {
                pageInfo {
                  count
                  countTotal
                }
                items {
                  id
                  timestamp
                  hash
                  blockNumber
                  caller
                  shares
                  assets
                  type
                  vault {
                    id
                    chain {
                      id
                    }
                  }
                  market {
                    uniqueKey
                  }
                }
              }
            }`;

            const response = await axios.post(MORPHO_API_BASE, { query });
            const validatedData = VaultReallocatesResponseSchema.parse(response.data);

            return {
              content: [{ type: 'text', text: JSON.stringify(validatedData.data.vaultReallocates, null, 2) }],
            };
      } catch (error: any) {
            return {
              isError: true,
              content: [{ type: 'text', text: `Error retrieving vault reallocates: ${error.message}` }],
            };
      }
  }

  if (name === GET_VAULTS_TOOL) {
    try {
      const queryParams = buildQueryParams(params as VaultQueryParams);
      const query = `
        query {
          vaults${queryParams} {
            items {
              address
              symbol
              name
              creationBlockNumber
              creationTimestamp
              creatorAddress
              whitelisted
              asset {
                id
                address
                decimals
              }
              chain {
                id
                network
              }
              state {
                id
                apy
                netApy
                totalAssets
                totalAssetsUsd
                fee
                timelock
              }
              warnings {
                type
                level
              }
            }
          }
        }`;

      const response = await axios.post(MORPHO_API_BASE, { query });
      const validatedData = VaultsResponseSchema.parse(response.data);

      return {
        content: [{ type: 'text', text: JSON.stringify(validatedData.data.vaults, null, 2) }]
      };
    } catch (error: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Error retrieving vaults: ${error.message}` }]
      };
    }
  }

  if (name === GET_VAULT_POSITIONS_TOOL) {
    try {
      const { vaultAddress, ...rest } = params as VaultPositionsParams;
      const queryParams = buildQueryParams({
        ...rest,
        where: { vaultAddress_in: [vaultAddress] }
      });

      const query = `
        query {
          vaultPositions${queryParams} {
            items {
              shares
              assets
              assetsUsd
              user {
                address
              }
            }
          }
        }`;

      const response = await axios.post(MORPHO_API_BASE, { query });
      const validatedData = VaultPositionsResponseSchema.parse(response.data);

      return {
        content: [{ type: 'text', text: JSON.stringify(validatedData.data.vaultPositions, null, 2) }]
      };
    } catch (error: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Error retrieving vault positions: ${error.message}` }]
      };
    }
  }

  if (name === GET_VAULT_TRANSACTIONS_TOOL) {
    try {
      const { type_in, ...rest } = params as VaultTransactionsParams;
      const queryParams = buildQueryParams({
        ...rest,
        where: { type_in }
      });

      const query = `
        query {
          transactions${queryParams} {
            items {
              hash
              timestamp
              type
              chain {
                id
                network
              }
              user {
                address
              }
              data {
                ... on VaultTransactionData {
                  shares
                  assets
                  vault {
                    address
                  }
                }
              }
            }
          }
        }`;

      const response = await axios.post(MORPHO_API_BASE, { query });
      const validatedData = VaultTransactionsResponseSchema.parse(response.data);

      return {
        content: [{ type: 'text', text: JSON.stringify(validatedData.data.transactions, null, 2) }]
      };
    } catch (error: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Error retrieving vault transactions: ${error.message}` }]
      };
    }
  }

  if (name === GET_VAULT_APY_HISTORY_TOOL) {
    try {
      const { address, options } = params as VaultApyHistoryParams;
      const query = `
        query {
          vaultByAddress(address: "${address}") {
            address
            historicalState {
              apy(options: {
                startTimestamp: ${options.startTimestamp}
                endTimestamp: ${options.endTimestamp}
                interval: ${options.interval}
              }) {
                x
                y
              }
              netApy(options: {
                startTimestamp: ${options.startTimestamp}
                endTimestamp: ${options.endTimestamp}
                interval: ${options.interval}
              }) {
                x
                y
              }
            }
          }
        }`;

      const response = await axios.post(MORPHO_API_BASE, { query });
      const validatedData = VaultApyHistoryResponseSchema.parse(response.data);

      return {
        content: [{ type: 'text', text: JSON.stringify(validatedData.data.vaultByAddress, null, 2) }]
      };
    } catch (error: any) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Error retrieving vault APY history: ${error.message}` }]
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