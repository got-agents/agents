# Linear Assistant TypeScript Implementation

## Project Structure
- `src/` - Contains all TypeScript source files
- `dist/` - Contains compiled JavaScript (created after build)

## Available Scripts
- `npm run dev` - Start development server with hot reload
- `npm run build` - Build the project
- `npm start` - Run the built project

## Development Guidelines
- Use TypeScript types for all Express routes
- Keep route handlers in separate files as the project grows
- Add error handling middleware for production use
- Configure Express body-parser with increased limit for large payloads (50mb)

## Configuration
- `ALLOWED_EMAILS`: Comma-separated list of email addresses allowed to use the bot. If empty, all emails are allowed.

## Purpose
TypeScript implementation of the Linear Assistant, providing a type-safe API for Linear issue management.

## External Services

### Caching
- Read operations (teams, users, projects, labels, mailing lists) are cached for 6 hours
- Context squashing results are cached with composite key of operation
- Cache uses Redis at redis://redis:6379/1
- Write operations bypass cache
- Keep cache keys simple to avoid PayloadTooLargeError

### Loops
- Initialize with `new LoopsClient(apiKey)`
- Import using `import { LoopsClient, APIError } from 'loops'`
- Used for mailing list management
- Provides error handling via APIError class for API-specific errors
