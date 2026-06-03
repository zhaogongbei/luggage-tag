#!/bin/bash
# 优化工作自动化验收脚本
# 用法: bash verify_optimizations.sh [token]

set -e

API_BASE="http://localhost:3000"
TOKEN="${1:-test-token}"
PASS_COUNT=0
FAIL_COUNT=0

echo "====== 优化工作验收测试 ======"
echo ""

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

test_case() {
  local name=$1
  local expected=$2
  local actual=$3

  if [[ "$actual" == "$expected" ]] || grep -q "$expected" <<< "$actual"; then
    echo -e "${GREEN}✓ PASS${NC}: $name"
    ((PASS_COUNT++))
  else
    echo -e "${RED}✗ FAIL${NC}: $name"
    echo "  Expected: $expected"
    echo "  Actual: $actual"
    ((FAIL_COUNT++))
  fi
}

# ============ H2: 统计查询合并 ============
echo -e "\n${YELLOW}[H2] 统计查询 (单个请求)${NC}"
START=$(date +%s%N)
STATS_RESPONSE=$(curl -s -H "Cookie: session=$TOKEN" "$API_BASE/api/orders/stats")
END=$(date +%s%N)
RESPONSE_TIME=$(( (END - START) / 1000000 ))

test_case "H2: 统计响应包含 total" "total" "$STATS_RESPONSE"
test_case "H2: 统计响应包含 printed" "printed" "$STATS_RESPONSE"
test_case "H2: 统计响应包含 pending" "pending" "$STATS_RESPONSE"
test_case "H2: 响应时间 < 200ms" "true" "$([ $RESPONSE_TIME -lt 200 ] && echo true || echo false)"
echo "  Response time: ${RESPONSE_TIME}ms"

# ============ M3: 健康检查 ============
echo -e "\n${YELLOW}[M3] 健康检查端点${NC}"
HEALTH=$(curl -s "$API_BASE/health")
test_case "M3: /health 返回 status=ok" "ok" "$HEALTH"
test_case "M3: /health 包含 uptime" "uptime" "$HEALTH"

# ============ M1: 速率限制 ============
echo -e "\n${YELLOW}[M1] API 速率限制${NC}"
# 尝试 25 次 POST /api/orders/imposition (限制 20/min)
LIMIT_FAIL=0
for i in {1..25}; do
  RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/api/orders/imposition" \
    -H "Content-Type: application/json" \
    -d '{"orderIds":[]}' 2>/dev/null)
  HTTP_CODE=$(echo "$RESPONSE" | tail -1)
  if [ $i -gt 20 ] && [ "$HTTP_CODE" = "429" ]; then
    ((LIMIT_FAIL++))
  elif [ $i -le 20 ] && [ "$HTTP_CODE" != "429" ]; then
    :  # OK
  fi
done
test_case "M1: 超过 20/min 返回 429" "true" "$([ $LIMIT_FAIL -gt 0 ] && echo true || echo false)"

# ============ 数据库检查 ============
echo -e "\n${YELLOW}[DB] 数据库索引${NC}"
INDEX_COUNT=$(sqlite3 /c/Users/Administrator/luggage-tag/luggage_tag.db \
  "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND (name LIKE 'idx_%' OR name LIKE 'sqlite_%');" 2>/dev/null || echo "0")
test_case "DB: 索引数 >= 8" "true" "$([ $INDEX_COUNT -ge 8 ] && echo true || echo false)"
echo "  Actual index count: $INDEX_COUNT"

# ============ 审计日志检查 ============
echo -e "\n${YELLOW}[H1] 审计日志限制${NC}"
AUDIT_COUNT=$(sqlite3 /c/Users/Administrator/luggage-tag/luggage_tag.db \
  "SELECT COUNT(*) FROM audit_logs;" 2>/dev/null || echo "0")
test_case "H1: 审计日志 <= 5000" "true" "$([ $AUDIT_COUNT -le 5000 ] && echo true || echo false)"
echo "  Current audit log count: $AUDIT_COUNT"

# ============ 代码检查 ============
echo -e "\n${YELLOW}[CODE] 代码质量${NC}"
LINT_RESULT=$(npm run lint 2>&1 || echo "FAILED")
if echo "$LINT_RESULT" | grep -q "0 errors"; then
  echo -e "${GREEN}✓ PASS${NC}: npm run lint (0 errors)"
  ((PASS_COUNT++))
else
  echo -e "${RED}✗ FAIL${NC}: npm run lint (有错误)"
  ((FAIL_COUNT++))
fi

# ============ 总结 ============
echo -e "\n====== 测试结果总结 ======"
echo -e "${GREEN}通过: $PASS_COUNT${NC}"
echo -e "${RED}失败: $FAIL_COUNT${NC}"

if [ $FAIL_COUNT -eq 0 ]; then
  echo -e "\n${GREEN}✓ 所有测试通过，可部署${NC}"
  exit 0
else
  echo -e "\n${RED}✗ 有测试失败，请检查${NC}"
  exit 1
fi
