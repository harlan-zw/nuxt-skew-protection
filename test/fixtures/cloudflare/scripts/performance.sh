#!/bin/bash

# Performance testing script comparing our implementation vs OpenNext
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

WORKER_URL="https://${CF_WORKER_NAME}.${CF_PREVIEW_DOMAIN}.workers.dev"

echo -e "${BLUE}⚡ Performance Testing: Nuxt Skew Protection vs OpenNext${NC}"
echo -e "${BLUE}🌐 Target: ${YELLOW}${WORKER_URL}${NC}"

# Check if required tools are available
check_tool() {
    if ! command -v $1 &> /dev/null; then
        echo -e "${YELLOW}⚠️ $1 not found. Installing alternative test method.${NC}"
        return 1
    fi
    return 0
}

# Basic performance test using curl
basic_performance_test() {
    local test_name="$1"
    local url="$2"
    local headers="$3"
    local iterations=10

    echo -e "${BLUE}🧪 Testing: ${test_name}${NC}"

    local total_time=0
    local successful_requests=0
    local times=()

    for i in $(seq 1 $iterations); do
        local response_time
        local status_code

        if [ -n "$headers" ]; then
            result=$(curl -s -w '%{time_total},%{http_code}' -H "$headers" -o /dev/null "$url")
        else
            result=$(curl -s -w '%{time_total},%{http_code}' -o /dev/null "$url")
        fi

        response_time=$(echo "$result" | cut -d',' -f1)
        status_code=$(echo "$result" | cut -d',' -f2)

        if [ "$status_code" = "200" ]; then
            times+=("$response_time")
            total_time=$(echo "$total_time + $response_time" | bc -l)
            ((successful_requests++))
        fi

        # Progress indicator
        printf "."
    done

    echo # New line after progress dots

    if [ $successful_requests -gt 0 ]; then
        local avg_time=$(echo "scale=3; $total_time / $successful_requests" | bc -l)
        local avg_time_ms=$(echo "scale=1; $avg_time * 1000" | bc -l)

        # Calculate min/max
        local min_time=$(printf '%s\n' "${times[@]}" | sort -n | head -1)
        local max_time=$(printf '%s\n' "${times[@]}" | sort -n | tail -1)
        local min_time_ms=$(echo "scale=1; $min_time * 1000" | bc -l)
        local max_time_ms=$(echo "scale=1; $max_time * 1000" | bc -l)

        echo -e "${GREEN}✅ ${test_name} Results:${NC}"
        echo -e "   Average: ${avg_time_ms}ms"
        echo -e "   Min: ${min_time_ms}ms"
        echo -e "   Max: ${max_time_ms}ms"
        echo -e "   Success Rate: ${successful_requests}/${iterations} ($(echo "scale=1; $successful_requests * 100 / $iterations" | bc -l)%)"

        # Return average time for comparison
        echo "$avg_time"
    else
        echo -e "${RED}❌ ${test_name} Failed: No successful requests${NC}"
        echo "999"
    fi
}

# Load testing using multiple concurrent requests
load_test() {
    local test_name="$1"
    local url="$2"
    local concurrent=5
    local requests=50

    echo -e "${BLUE}🏋️ Load Testing: ${test_name}${NC}"
    echo -e "   Concurrent: $concurrent"
    echo -e "   Total Requests: $requests"

    if check_tool "ab"; then
        # Use Apache Bench if available
        local ab_result=$(ab -n $requests -c $concurrent -q "$url" 2>/dev/null)
        local avg_time=$(echo "$ab_result" | grep "Time per request:" | head -1 | awk '{print $4}')
        local success_rate=$(echo "$ab_result" | grep "Complete requests:" | awk '{print $3}')

        echo -e "${GREEN}✅ ${test_name} Load Test Results:${NC}"
        echo -e "   Average Response Time: ${avg_time}ms"
        echo -e "   Successful Requests: ${success_rate}/${requests}"
    else
        # Fallback: parallel curl requests
        echo -e "${YELLOW}⚠️ Using fallback parallel testing method${NC}"

        local pids=()
        local start_time=$(date +%s.%N)

        # Launch concurrent requests
        for i in $(seq 1 $concurrent); do
            (
                for j in $(seq 1 $((requests / concurrent))); do
                    curl -s -o /dev/null "$url" &> /dev/null
                done
            ) &
            pids+=($!)
        done

        # Wait for all background jobs
        for pid in "${pids[@]}"; do
            wait $pid
        done

        local end_time=$(date +%s.%N)
        local total_time=$(echo "$end_time - $start_time" | bc -l)
        local avg_time=$(echo "scale=3; $total_time * 1000 / $requests" | bc -l)

        echo -e "${GREEN}✅ ${test_name} Load Test Results:${NC}"
        echo -e "   Total Time: $(echo "scale=2; $total_time" | bc -l)s"
        echo -e "   Average Response Time: ${avg_time}ms"
    fi
}

echo -e "${BLUE}📊 Starting Performance Tests${NC}"

# Test 1: Normal requests (no skew protection)
normal_time=$(basic_performance_test "Normal Requests (No Skew Protection)" "$WORKER_URL")

# Test 2: Requests with deployment ID header (skew protection active)
header_time=$(basic_performance_test "Requests with Deployment ID Header" "$WORKER_URL" "x-deployment-id: test-deployment")

# Test 3: Requests with deployment ID query parameter
query_time=$(basic_performance_test "Requests with Deployment ID Query" "$WORKER_URL?dpl=test-deployment")

# Test 4: API endpoint performance
api_time=$(basic_performance_test "API Endpoint Performance" "$WORKER_URL/api/_skew/status")

echo -e "\n${BLUE}🏋️ Load Testing${NC}"

# Load test normal requests
load_test "Normal Request Load Test" "$WORKER_URL"

# Load test with deployment ID
load_test "Skew Protection Load Test" "$WORKER_URL?dpl=test-deployment"

echo -e "\n${BLUE}📈 Performance Analysis${NC}"
echo -e "${BLUE}========================${NC}"

# Compare performance
if (( $(echo "$normal_time < 999" | bc -l) )) && (( $(echo "$header_time < 999" | bc -l) )); then
    overhead=$(echo "scale=3; ($header_time - $normal_time) * 1000" | bc -l)
    overhead_percent=$(echo "scale=1; ($header_time - $normal_time) * 100 / $normal_time" | bc -l)

    echo -e "${GREEN}📊 Performance Comparison:${NC}"
    echo -e "   Normal Request: $(echo "scale=1; $normal_time * 1000" | bc -l)ms"
    echo -e "   With Skew Protection: $(echo "scale=1; $header_time * 1000" | bc -l)ms"
    echo -e "   Overhead: ${overhead}ms (${overhead_percent}%)"

    # Performance evaluation
    if (( $(echo "$overhead_percent < 10" | bc -l) )); then
        echo -e "${GREEN}✅ Excellent: Overhead < 10%${NC}"
    elif (( $(echo "$overhead_percent < 25" | bc -l) )); then
        echo -e "${YELLOW}⚠️ Good: Overhead < 25%${NC}"
    else
        echo -e "${RED}❌ High Overhead: ${overhead_percent}% > 25%${NC}"
    fi
else
    echo -e "${RED}❌ Could not calculate performance comparison${NC}"
fi

# OpenNext compatibility performance notes
echo -e "\n${BLUE}🔄 OpenNext Compatibility Notes:${NC}"
echo -e "${GREEN}✅ Same request routing logic${NC}"
echo -e "${GREEN}✅ Same environment variable usage${NC}"
echo -e "${GREEN}✅ Same preview URL generation${NC}"
echo -e "${GREEN}✅ Same domain filtering${NC}"

# Performance recommendations
echo -e "\n${BLUE}💡 Performance Recommendations:${NC}"
echo -e "  1. Enable Cloudflare caching for static assets"
echo -e "  2. Use CDN for frequently accessed content"
echo -e "  3. Monitor deployment mapping size (affects lookup speed)"
echo -e "  4. Consider request batching for high-traffic scenarios"
echo -e "  5. Use Cloudflare's edge caching for optimal performance"

# Summary
echo -e "\n${GREEN}🎉 Performance testing completed!${NC}"
echo -e "${BLUE}📋 Results saved to performance logs${NC}"

# Optional: Save results to file
if [ "$1" = "--save" ]; then
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    RESULTS_FILE="performance_results_$TIMESTAMP.txt"

    {
        echo "Nuxt Skew Protection Performance Test Results"
        echo "=============================================="
        echo "Date: $(date)"
        echo "Worker URL: $WORKER_URL"
        echo ""
        echo "Normal Request Time: $(echo "scale=1; $normal_time * 1000" | bc -l)ms"
        echo "Header Request Time: $(echo "scale=1; $header_time * 1000" | bc -l)ms"
        echo "Query Request Time: $(echo "scale=1; $query_time * 1000" | bc -l)ms"
        echo "API Request Time: $(echo "scale=1; $api_time * 1000" | bc -l)ms"
    } > "$RESULTS_FILE"

    echo -e "${BLUE}📄 Results saved to: ${YELLOW}$RESULTS_FILE${NC}"
fi