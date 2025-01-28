# Morpho API MCP Server

A Model Context Protocol (MCP) server that provides tools for querying the Morpho API. This server enables Claude to interact with Morpho's GraphQL API, providing access to market data, vaults, positions, and more.

<a href="https://glama.ai/mcp/servers/t3vqcxa90h"><img width="380" height="200" src="https://glama.ai/mcp/servers/t3vqcxa90h/badge" alt="Morpho API Server MCP server" /></a>

## Features

* Query Morpho markets data through GraphQL
* Full support for vaults, positions, and transactions
* Historical APY data and oracle information
* Comprehensive pagination, ordering, and filtering options
* Data validation using Zod schemas
* Error handling and type safety
* MCP-compliant server implementation

## Installation

1. Install the package:
```bash
npm install mcp-morpho-server
```

2. Add to your Claude Desktop configuration:
```json
{
  "tools": {
    "morpho": {
      "command": "node",
      "args": [
        "/path/to/node_modules/mcp-morpho-server/build/index.js"
      ]
    }
  }
}
```

## Available Tools

### Markets
- `get_markets`: Retrieve all markets with pagination and filtering
- `get_whitelisted_markets`: Get only whitelisted markets
- `get_market_positions`: Get positions for specific markets
- `get_historical_apy`: Get historical APY data
- `get_oracle_details`: Get oracle information

### Vaults
- `get_vaults`: Get all vaults with their current states
- `get_vault_positions`: Get positions for specific vaults
- `get_vault_transactions`: Get vault transaction history
- `get_vault_allocation`: Get vault market allocations
- `get_vault_reallocates`: Get vault reallocation history
- `get_vault_apy_history`: Get historical APY data for vaults

### Assets and Accounts
- `get_asset_price`: Get current price and yield information
- `get_account_overview`: Get account positions and transactions
- `get_liquidations`: Get liquidation events

## Development

The project is written in TypeScript and uses:
* @modelcontextprotocol/sdk for MCP server implementation
* axios for API requests
* zod for schema validation

To build from source:

1. Clone the repository
```bash
git clone https://github.com/crazyrabbitLTC/mcp-morpho-server.git
```

2. Install dependencies:
```bash
npm install
```

3. Build the project:
```bash
npm run build
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

ISC

## Author

Created by [Your Name] (<your@email>) 
