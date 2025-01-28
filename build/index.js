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
// Market Schema
const MarketSchema = z.object({
    uniqueKey: z.string(),
    lltv: z.union([z.string(), z.number()]).transform(stringToNumber),
    oracleAddress: z.string(),
    irmAddress: z.string(),
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
