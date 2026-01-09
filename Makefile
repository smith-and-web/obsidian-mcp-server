# Obsidian MCP Server - Makefile
# Common commands for development and deployment

.PHONY: help install dev start docker-build docker-up docker-down docker-logs docker-restart test-connection clean

# Default target
help:
	@echo "Obsidian MCP Server - Available commands:"
	@echo ""
	@echo "  Development:"
	@echo "    make install         Install dependencies"
	@echo "    make dev             Run server with hot-reload"
	@echo "    make start           Run server in production mode"
	@echo "    make test-connection Test server connectivity"
	@echo ""
	@echo "  Docker:"
	@echo "    make docker-build    Build Docker image"
	@echo "    make docker-up       Start Docker container"
	@echo "    make docker-down     Stop Docker container"
	@echo "    make docker-logs     View container logs"
	@echo "    make docker-restart  Restart container"
	@echo "    make docker-shell    Open shell in container"
	@echo ""
	@echo "  Utilities:"
	@echo "    make clean           Remove node_modules and build artifacts"
	@echo ""

# Development
install:
	npm install

dev:
	@echo "Starting server in development mode..."
	@echo "Make sure VAULT_PATH is set (default: ./examples/test-vault)"
	VAULT_PATH=$${VAULT_PATH:-./examples/test-vault} npm run dev

start:
	npm start

test-connection:
	@./scripts/test-connection.sh

# Docker commands
docker-build:
	docker-compose build

docker-up:
	docker-compose up -d

docker-down:
	docker-compose down

docker-logs:
	docker-compose logs -f obsidian-mcp

docker-restart:
	docker-compose restart

docker-shell:
	docker exec -it obsidian-mcp sh

# Docker development (with hot-reload)
docker-dev:
	docker-compose -f docker-compose.yml -f docker-compose.dev.yml up

# Utilities
clean:
	rm -rf node_modules
	rm -rf dist
	rm -rf coverage

# Run all tests (placeholder for future test suite)
test:
	@echo "No tests configured yet. Run 'make test-connection' to verify server connectivity."
