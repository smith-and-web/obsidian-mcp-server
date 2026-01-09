#!/bin/bash
# Test connection to Obsidian MCP Server
# Usage: ./scripts/test-connection.sh [URL]

set -e

URL="${1:-http://localhost:3001}"

echo "Testing Obsidian MCP Server at $URL"
echo "========================================"
echo ""

# Test health endpoint
echo "1. Health Check..."
HEALTH=$(curl -s "$URL/health" 2>/dev/null || echo '{"error": "Connection failed"}')
if echo "$HEALTH" | grep -q '"status":"ok"'; then
    echo "   ✓ Server is healthy"
    echo "   $HEALTH"
else
    echo "   ✗ Health check failed"
    echo "   $HEALTH"
    exit 1
fi
echo ""

# Test tools/list
echo "2. Listing tools..."
TOOLS=$(curl -s -X POST "$URL/sse" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}' 2>/dev/null)

TOOL_COUNT=$(echo "$TOOLS" | grep -o '"name"' | wc -l | tr -d ' ')
if [ "$TOOL_COUNT" -gt 0 ]; then
    echo "   ✓ Found $TOOL_COUNT tools"
else
    echo "   ✗ Failed to list tools"
    exit 1
fi
echo ""

# Test list-vault
echo "3. Testing list-vault..."
VAULT=$(curl -s -X POST "$URL/sse" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "list-vault", "arguments": {}}}' 2>/dev/null)

if echo "$VAULT" | grep -q '"result"'; then
    echo "   ✓ Vault accessible"
else
    echo "   ✗ Failed to access vault"
    echo "   $VAULT"
    exit 1
fi
echo ""

echo "========================================"
echo "All tests passed! Server is ready."
echo ""
echo "Next steps:"
echo "  - Import Bruno collection from ./bruno/obsidian-mcp"
echo "  - Configure Claude Desktop with this URL"
echo ""
