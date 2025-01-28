# Morpho API MCP Server

A Model Context Protocol (MCP) server that provides tools for querying the Morpho API.

## Features

- Query Morpho markets data through GraphQL
- Data validation using Zod schemas
- Error handling and type safety
- MCP-compliant server implementation

## Installation

1. Clone the repository
2. Install dependencies:
```bash
npm install
```

## Building

Build the TypeScript project:
```bash
npm run build
```

## Usage

Start the server:
```bash
npm start
```

The server provides the following tools:

### get_markets

Retrieves all available markets from Morpho, including:
- Unique market identifiers
- Loan and collateral asset details
- Market state (APY, assets, utilization, etc.)
- Oracle and IRM addresses

## Development

The project is written in TypeScript and uses:
- @modelcontextprotocol/sdk for MCP server implementation
- axios for API requests
- zod for schema validation

## License

ISC 