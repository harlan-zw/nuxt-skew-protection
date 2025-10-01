#!/bin/bash

# Cloudflare Workers Test Setup Script
set -e

echo "🛡️ Setting up Cloudflare Workers test environment for Nuxt Skew Protection"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if required tools are installed
check_tool() {
    if ! command -v $1 &> /dev/null; then
        echo -e "${RED}❌ $1 is not installed. Please install it first.${NC}"
        exit 1
    else
        echo -e "${GREEN}✅ $1 is installed${NC}"
    fi
}

echo -e "${BLUE}📋 Checking prerequisites...${NC}"
check_tool "node"
check_tool "npm"
check_tool "wrangler"

# Check if wrangler is authenticated
echo -e "${BLUE}🔐 Checking Wrangler authentication...${NC}"
if ! wrangler whoami &> /dev/null; then
    echo -e "${YELLOW}⚠️ Wrangler not authenticated. Please run 'wrangler login' first.${NC}"
    read -p "Would you like to login now? (y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        wrangler login
    else
        echo -e "${RED}❌ Authentication required to continue.${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}✅ Wrangler authenticated${NC}"
fi

# Check for environment file
echo -e "${BLUE}📝 Checking environment configuration...${NC}"
if [ ! -f ".env.local" ]; then
    if [ -f ".env.example" ]; then
        echo -e "${YELLOW}⚠️ .env.local not found. Copying from .env.example${NC}"
        cp .env.example .env.local
        echo -e "${YELLOW}📝 Please edit .env.local with your Cloudflare configuration${NC}"
        echo -e "${YELLOW}Required variables:${NC}"
        echo -e "  - CF_ACCOUNT_ID"
        echo -e "  - CF_WORKERS_SCRIPTS_API_TOKEN"
        echo -e "  - CF_WORKER_NAME"
        echo -e "  - CF_PREVIEW_DOMAIN"
        exit 1
    else
        echo -e "${RED}❌ .env.example not found. Please check the repository.${NC}"
        exit 1
    fi
else
    echo -e "${GREEN}✅ Environment file found${NC}"
fi

# Load environment variables
echo -e "${BLUE}🔧 Loading environment variables...${NC}"
if [ -f ".env.local" ]; then
    export $(cat .env.local | grep -v '^#' | xargs)
fi

# Validate required environment variables
validate_env() {
    if [ -z "${!1}" ]; then
        echo -e "${RED}❌ Environment variable $1 is not set${NC}"
        return 1
    else
        echo -e "${GREEN}✅ $1 is set${NC}"
        return 0
    fi
}

echo -e "${BLUE}✅ Validating environment variables...${NC}"
validate_env "CF_ACCOUNT_ID" || exit 1
validate_env "CF_WORKERS_SCRIPTS_API_TOKEN" || exit 1
validate_env "CF_WORKER_NAME" || exit 1
validate_env "CF_PREVIEW_DOMAIN" || exit 1

# Install dependencies
echo -e "${BLUE}📦 Installing dependencies...${NC}"
cd app
if [ ! -d "node_modules" ]; then
    npm install
    echo -e "${GREEN}✅ Dependencies installed${NC}"
else
    echo -e "${GREEN}✅ Dependencies already installed${NC}"
fi

# Build the application
echo -e "${BLUE}🔨 Building Nuxt application...${NC}"
npm run build
echo -e "${GREEN}✅ Application built successfully${NC}"

# Test wrangler configuration
echo -e "${BLUE}🧪 Testing Wrangler configuration...${NC}"
if wrangler dev --dry-run &> /dev/null; then
    echo -e "${GREEN}✅ Wrangler configuration is valid${NC}"
else
    echo -e "${RED}❌ Wrangler configuration has issues${NC}"
    exit 1
fi

cd ..

echo -e "${GREEN}🎉 Setup complete! Ready for testing.${NC}"
echo -e "${BLUE}📋 Next steps:${NC}"
echo -e "  1. Review your .env.local configuration"
echo -e "  2. Run: ${YELLOW}./scripts/deploy.sh${NC} to deploy the test app"
echo -e "  3. Run: ${YELLOW}./scripts/test.sh${NC} to run automated tests"
echo -e "  4. Visit your worker URL to test manually"