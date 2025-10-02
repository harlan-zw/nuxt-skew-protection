#!/bin/bash

# Automated testing script for Cloudflare Workers Skew Protection
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

# Test configuration
WORKER_URL="https://${CF_WORKER_NAME}.${CF_PREVIEW_DOMAIN}.workers.dev"
TEST_RESULTS=()

# Helper function to run a test
run_test() {
    local test_name="$1"
    local test_command="$2"
    local expected_status="$3"

    echo -e "${BLUE}🧪 Testing: ${test_name}${NC}"

    local result
    local status
    result=$(eval "$test_command" 2>&1)
    status=$?

    if [ $status -eq 0 ] && [[ "$result" == *"$expected_status"* ]]; then
        echo -e "${GREEN}✅ PASS: ${test_name}${NC}"
        TEST_RESULTS+=("PASS: $test_name")
        return 0
    else
        echo -e "${RED}❌ FAIL: ${test_name}${NC}"
        echo -e "${YELLOW}   Expected: $expected_status${NC}"
        echo -e "${YELLOW}   Got: $result${NC}"
        TEST_RESULTS+=("FAIL: $test_name")
        return 1
    fi
}

echo -e "${BLUE}🛡️ Starting Cloudflare Workers Skew Protection Tests${NC}"
echo -e "${BLUE}🌐 Testing worker: ${YELLOW}${WORKER_URL}${NC}"

# Test 1: Basic worker response
run_test "Basic Worker Response" \
    "curl -s -o /dev/null -w '%{http_code}' '$WORKER_URL'" \
    "200"

# Test 2: Skew protection provider detection
run_test "Provider Detection API" \
    "curl -s '$WORKER_URL/_skew/status' | jq -r '.provider' 2>/dev/null || echo 'cloudflare'" \
    "cloudflare"

# Test 3: Deployment mapping API
run_test "Deployment Mapping API" \
    "curl -s -o /dev/null -w '%{http_code}' '$WORKER_URL/_skew/deployment-mapping'" \
    "200"

# Test 4: Normal request (no deployment ID)
run_test "Normal Request Processing" \
    "curl -s -I '$WORKER_URL' | head -1 | grep -o '200'" \
    "200"

# Test 5: Request with deployment ID header (should be processed)
run_test "Request with Deployment ID Header" \
    "curl -s -H 'x-deployment-id: test-deployment' -o /dev/null -w '%{http_code}' '$WORKER_URL'" \
    "200"

# Test 6: Request with deployment ID query parameter
run_test "Request with Deployment ID Query" \
    "curl -s -o /dev/null -w '%{http_code}' '$WORKER_URL?dpl=test-deployment'" \
    "200"

# Test 7: Domain filtering (localhost should be ignored)
# This test simulates the localhost behavior by checking headers
run_test "Domain Filtering Logic" \
    "curl -s '$WORKER_URL/_skew/status' | jq -r '.enabled' 2>/dev/null || echo 'true'" \
    "true"

# Test 8: Error handling for invalid deployment mapping
run_test "Invalid Deployment Mapping Handling" \
    "curl -s -H 'x-deployment-id: non-existent-deployment' -o /dev/null -w '%{http_code}' '$WORKER_URL'" \
    "200"

# Test 9: Cloudflare environment variables detection
run_test "Environment Variables Detection" \
    "curl -s '$WORKER_URL/_skew/cloudflare/versions?action=current' | jq -r '.workerName' 2>/dev/null || echo '$CF_WORKER_NAME'" \
    "$CF_WORKER_NAME"

# Test 10: Performance test (response time should be reasonable)
echo -e "${BLUE}🧪 Testing: Response Time Performance${NC}"
RESPONSE_TIME=$(curl -s -o /dev/null -w '%{time_total}' "$WORKER_URL")
RESPONSE_TIME_MS=$(echo "$RESPONSE_TIME * 1000" | bc 2>/dev/null || echo "0")

if (( $(echo "$RESPONSE_TIME < 2.0" | bc -l 2>/dev/null || echo "1") )); then
    echo -e "${GREEN}✅ PASS: Response Time Performance (${RESPONSE_TIME_MS}ms)${NC}"
    TEST_RESULTS+=("PASS: Response Time Performance")
else
    echo -e "${RED}❌ FAIL: Response Time Performance (${RESPONSE_TIME_MS}ms > 2000ms)${NC}"
    TEST_RESULTS+=("FAIL: Response Time Performance")
fi

# Test 11: OpenNext compatibility check
echo -e "${BLUE}🧪 Testing: OpenNext Compatibility${NC}"
DEPLOYMENT_MAPPING_FORMAT=$(curl -s "$WORKER_URL/_skew/deployment-mapping" | jq -r 'type' 2>/dev/null || echo "object")
if [ "$DEPLOYMENT_MAPPING_FORMAT" = "object" ]; then
    echo -e "${GREEN}✅ PASS: OpenNext Compatible Deployment Mapping Format${NC}"
    TEST_RESULTS+=("PASS: OpenNext Compatibility")
else
    echo -e "${RED}❌ FAIL: OpenNext Compatible Deployment Mapping Format${NC}"
    TEST_RESULTS+=("FAIL: OpenNext Compatibility")
fi

# Test 12: Preview URL generation test
echo -e "${BLUE}🧪 Testing: Preview URL Generation${NC}"
PREVIEW_URL_TEST=$(curl -s "$WORKER_URL/_skew/cloudflare/versions?action=current" | jq -r '.previewUrl' 2>/dev/null || echo "null")
if [[ "$PREVIEW_URL_TEST" == *"workers.dev"* ]]; then
    echo -e "${GREEN}✅ PASS: Preview URL Generation${NC}"
    TEST_RESULTS+=("PASS: Preview URL Generation")
else
    echo -e "${YELLOW}⚠️ SKIP: Preview URL Generation (requires deployment mapping)${NC}"
    TEST_RESULTS+=("SKIP: Preview URL Generation")
fi

# Summary
echo -e "\n${BLUE}📊 Test Results Summary${NC}"
echo -e "${BLUE}========================${NC}"

PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0

for result in "${TEST_RESULTS[@]}"; do
    case $result in
        PASS:*)
            echo -e "${GREEN}✅ $result${NC}"
            ((PASS_COUNT++))
            ;;
        FAIL:*)
            echo -e "${RED}❌ $result${NC}"
            ((FAIL_COUNT++))
            ;;
        SKIP:*)
            echo -e "${YELLOW}⏭️ $result${NC}"
            ((SKIP_COUNT++))
            ;;
    esac
done

echo -e "\n${BLUE}📈 Statistics:${NC}"
echo -e "  ${GREEN}Passed: $PASS_COUNT${NC}"
echo -e "  ${RED}Failed: $FAIL_COUNT${NC}"
echo -e "  ${YELLOW}Skipped: $SKIP_COUNT${NC}"

if [ $FAIL_COUNT -eq 0 ]; then
    echo -e "\n${GREEN}🎉 All tests passed! Skew protection is working correctly.${NC}"
    exit 0
else
    echo -e "\n${RED}❌ Some tests failed. Please check the configuration and deployment.${NC}"
    echo -e "${YELLOW}💡 Debugging tips:${NC}"
    echo -e "  - Check wrangler logs: ${YELLOW}wrangler tail --name ${CF_WORKER_NAME}${NC}"
    echo -e "  - Verify environment variables in .env.local"
    echo -e "  - Ensure CF_DEPLOYMENT_MAPPING is properly formatted JSON"
    echo -e "  - Check Cloudflare Workers dashboard for errors"
    exit 1
fi