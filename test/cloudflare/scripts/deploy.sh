#!/bin/bash

# Cloudflare Workers Deployment Script for Skew Protection Testing
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Load environment variables
if [ -f ".env.local" ]; then
    export $(cat .env.local | grep -v '^#' | xargs)
fi

echo -e "${BLUE}🚀 Deploying Nuxt Skew Protection Test to Cloudflare Workers${NC}"

# Generate unique deployment ID for this deployment
DEPLOYMENT_ID="dpl-$(date +%s | base64 | tr -d '=' | tr '[:upper:]' '[:lower:]' | head -c 8)"
echo -e "${BLUE}📋 Deployment ID: ${YELLOW}${DEPLOYMENT_ID}${NC}"

# Update environment variables for this deployment
export NUXT_DEPLOYMENT_ID=$DEPLOYMENT_ID

cd app

# Rebuild with new deployment ID
echo -e "${BLUE}🔨 Building with deployment ID: ${DEPLOYMENT_ID}${NC}"
npm run build

# Deploy to Cloudflare Pages
echo -e "${BLUE}☁️ Deploying to Cloudflare Pages...${NC}"
wrangler pages deploy .output/public --project-name="${CF_WORKER_NAME}" --branch=main

# Get the deployed pages URL
WORKER_URL="https://${CF_WORKER_NAME}.pages.dev"
echo -e "${GREEN}✅ Deployed successfully!${NC}"
echo -e "${BLUE}🌐 Worker URL: ${YELLOW}${WORKER_URL}${NC}"

# Wait a moment for deployment to propagate
echo -e "${BLUE}⏳ Waiting for deployment to propagate...${NC}"
sleep 5

# Test the deployment
echo -e "${BLUE}🧪 Testing deployment...${NC}"
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$WORKER_URL" || echo "000")

if [ "$HTTP_STATUS" = "200" ]; then
    echo -e "${GREEN}✅ Deployment is responding (HTTP $HTTP_STATUS)${NC}"
else
    echo -e "${RED}❌ Deployment test failed (HTTP $HTTP_STATUS)${NC}"
    echo -e "${YELLOW}💡 Check Wrangler logs: wrangler tail --name ${CF_WORKER_NAME}${NC}"
fi

# Get current worker versions
echo -e "${BLUE}📋 Getting current worker versions...${NC}"
VERSIONS=$(wrangler versions list --name "$CF_WORKER_NAME" --json 2>/dev/null || echo "[]")
echo -e "${BLUE}Available versions:${NC}"
echo "$VERSIONS" | jq -r '.[] | "  \(.id) - \(.created_on)"' 2>/dev/null || echo "  No versions found or jq not available"

# Update deployment mapping
echo -e "${BLUE}🗺️ Updating deployment mapping...${NC}"
if [ -n "$VERSIONS" ] && [ "$VERSIONS" != "[]" ]; then
    # Get the latest version ID (most recent)
    LATEST_VERSION=$(echo "$VERSIONS" | jq -r '.[0].id' 2>/dev/null || echo "current")

    # Update deployment mapping
    CURRENT_MAPPING="${CF_DEPLOYMENT_MAPPING:-{}}"
    # Add new deployment with "current" and update previous current to actual version
    NEW_MAPPING=$(echo "$CURRENT_MAPPING" | jq --arg deploymentId "$DEPLOYMENT_ID" --arg latestVersion "$LATEST_VERSION" '
        # Replace any existing "current" values with the latest version
        to_entries |
        map(if .value == "current" then .value = $latestVersion else . end) |
        from_entries |
        # Add new deployment with "current"
        . + {($deploymentId): "current"}
    ' 2>/dev/null || echo "{\"$DEPLOYMENT_ID\": \"current\"}")

    echo -e "${BLUE}📋 Updated deployment mapping:${NC}"
    echo "$NEW_MAPPING" | jq . 2>/dev/null || echo "$NEW_MAPPING"

    echo -e "${YELLOW}💡 To enable version routing, set CF_DEPLOYMENT_MAPPING to:${NC}"
    echo "$NEW_MAPPING"
else
    echo -e "${YELLOW}⚠️ Could not retrieve worker versions. Manual mapping update required.${NC}"
fi

cd ..

echo -e "${GREEN}🎉 Deployment completed successfully!${NC}"
echo -e "${BLUE}📋 Next steps:${NC}"
echo -e "  1. Visit: ${YELLOW}${WORKER_URL}${NC}"
echo -e "  2. Test skew protection features in the UI"
echo -e "  3. Update CF_DEPLOYMENT_MAPPING environment variable"
echo -e "  4. Test version routing with: ${YELLOW}curl -H 'x-deployment-id: old-id' ${WORKER_URL}${NC}"
echo -e "  5. Monitor logs with: ${YELLOW}wrangler tail --name ${CF_WORKER_NAME}${NC}"