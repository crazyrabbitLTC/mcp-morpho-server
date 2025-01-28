#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import axios from 'axios';
import { z } from 'zod';
// Define the base URL for the Morpho API
const MORPHO_API_BASE = 'https://blue-api.morpho.org/graphql';
// Helper functions for number transformations
const stringToNumber = (val) => {
    if (val === null)
        return 0;
    return typeof val === 'string' ? Number(val) : val;
};
const toPercentage = (val) => {
    return val * 100;
};
const fromWei = (val, decimals) => {
    const num = stringToNumber(val);
    return num / (10 ** decimals);
};
// Define Zod schemas for data validation
// Asset Schema with unit documentation
const AssetSchema = z.object({
    address: z.string().describe('Ethereum address of the asset'),
    symbol: z.string().describe('Token symbol (e.g., "USDC", "ETH")'),
    decimals: z.number().describe('Number of decimal places for the token'),
}).nullable().transform(val => val || {
    address: '',
    symbol: '',
    decimals: 0
});
// Market Schema with unit documentation
const MarketSchema = z.object({
    uniqueKey: z.string().describe('Unique identifier for the market'),
    lltv: z.union([z.string(), z.number()])
        .transform(stringToNumber)
        .describe('Liquidation Loan-To-Value ratio as a decimal (e.g., 0.8 = 80%)'),
    oracleAddress: z.string().describe('Ethereum address of the price oracle'),
    irmAddress: z.string().describe('Ethereum address of the interest rate model'),
    loanAsset: AssetSchema.describe('Asset being borrowed'),
    collateralAsset: AssetSchema.describe('Asset being used as collateral'),
    state: z.object({
        borrowApy: z.number()
            .transform(toPercentage)
            .describe('Borrow Annual Percentage Yield (in %)'),
        borrowAssets: z.union([z.string(), z.number()])
            .describe('Total amount of assets borrowed in wei'),
        borrowAssetsUsd: z.number()
            .nullable()
            .transform(val => val ?? 0)
            .describe('USD value of borrowed assets'),
        supplyApy: z.number()
            .transform(toPercentage)
            .describe('Supply Annual Percentage Yield (in %)'),
        supplyAssets: z.union([z.string(), z.number()])
            .describe('Total amount of assets supplied in wei'),
        supplyAssetsUsd: z.number()
            .nullable()
            .transform(val => val ?? 0)
            .describe('USD value of supplied assets'),
        fee: z.number()
            .transform(toPercentage)
            .describe('Market fee rate (in %)'),
        utilization: z.number()
            .transform(toPercentage)
            .describe('Market utilization rate (in %)'),
    }).describe('Current state of the market'),
}).transform(market => ({
    ...market,
    state: {
        ...market.state,
        // Convert asset amounts using their respective decimals
        borrowAssets: fromWei(market.state.borrowAssets, market.loanAsset.decimals),
        supplyAssets: fromWei(market.state.supplyAssets, market.loanAsset.decimals),
    }
}));
// Combined items schema
const MarketsItemsSchema = z.object({
    items: z.array(MarketSchema),
});
// Morpho API Response Schema
const MorphoApiResponseSchema = z.object({
    data: z.object({
        markets: MarketsItemsSchema
    })
});
// Define tool names as constants to avoid typos
const GET_MARKETS_TOOL = 'get_markets';
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
                description: 'Retrieves all available markets from Morpho.',
                inputSchema: {
                    type: 'object',
                    properties: {}, // No input parameters for this tool
                },
            },
        ],
    };
});
// Implementation to handle tool execution requests
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name } = request.params;
    // Execute the correct function based on the tool being called
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
            // Validate the response with Zod
            const validatedData = MorphoApiResponseSchema.parse(response.data);
            return {
                content: [
                    {
                        type: 'text',
                        text: JSON.stringify(validatedData.data.markets.items, null, 2), // Format output
                    },
                ],
            };
        }
        catch (error) {
            console.error('Error calling Morpho API:', error.message);
            return {
                isError: true,
                content: [
                    {
                        type: 'text',
                        text: `Error retrieving markets: ${error.message}`,
                    },
                ],
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
