#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Server Monitor Agent — 一键安装 / 卸载脚本
#
# 环境变量:
#   SM_TOKEN       (必需) Agent 认证 Token
#   SM_PORT        (可选) 监听端口, 默认 9090
#   DOWNLOAD_URL   (可选) 二进制下载地址, 覆盖 GitHub Releases 默认地址
#   LOCAL_BINARY   (可选) 本地二进制路径, 跳过下载直接安装
#   VERSION        (可选) 版本号, 默认 latest
#   GITHUB_REPO    (可选) GitHub 仓库, 默认 your-org/server-monitor
#
# 用法:
#   安装:  curl -sSL <url>/install.sh | SM_TOKEN=xxx bash
#   本地:  SM_TOKEN=xxx LOCAL_BINARY=./server-monitor-agent-linux-amd64 bash install.sh
#   卸载:  bash install.sh --uninstall
# ============================================================

BINARY_NAME="server-monitor-agent"
INSTALL_DIR="/usr/local/bin"
SERVICE_NAME="server-monitor-agent"
ENV_FILE="/etc/${SERVICE_NAME}.env"
UNIT_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

GITHUB_REPO="${GITHUB_REPO:-zhx8702/server-monitor}"
VERSION="${VERSION:-latest}"
SM_PORT="${SM_PORT:-9090}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ---- 卸载 ----
uninstall() {
  info "开始卸载 ${SERVICE_NAME} ..."

  if systemctl is-active --quiet "${SERVICE_NAME}" 2>/dev/null; then
    info "停止服务 ..."
    systemctl stop "${SERVICE_NAME}"
  fi

  if systemctl is-enabled --quiet "${SERVICE_NAME}" 2>/dev/null; then
    info "禁用服务 ..."
    systemctl disable "${SERVICE_NAME}"
  fi

  [ -f "${UNIT_FILE}" ] && rm -f "${UNIT_FILE}" && info "已删除 ${UNIT_FILE}"
  [ -f "${ENV_FILE}" ]  && rm -f "${ENV_FILE}"  && info "已删除 ${ENV_FILE}"
  [ -f "${INSTALL_DIR}/${BINARY_NAME}" ] && rm -f "${INSTALL_DIR}/${BINARY_NAME}" && info "已删除 ${INSTALL_DIR}/${BINARY_NAME}"

  systemctl daemon-reload 2>/dev/null || true

  info "卸载完成!"
  exit 0
}

# ---- 参数解析 ----
for arg in "$@"; do
  case "${arg}" in
    --uninstall) uninstall ;;
  esac
done

# ---- 前置检查 ----
[ "$(id -u)" -ne 0 ] && error "请使用 root 权限运行此脚本 (sudo)"

if [ -z "${SM_TOKEN:-}" ]; then
  error "SM_TOKEN 未设置。用法: curl -sSL <url>/install.sh | SM_TOKEN=your_token bash"
fi

command -v systemctl >/dev/null 2>&1 || error "需要 systemd, 此脚本仅支持 systemd 系统"

# ---- 已运行检测: 如果服务在运行且有凭据, 返回现有信息跳过安装 ----
if systemctl is-active --quiet "${SERVICE_NAME}" 2>/dev/null && [ -f "${ENV_FILE}" ]; then
  EXISTING_TOKEN=$(grep '^SM_TOKEN=' "${ENV_FILE}" 2>/dev/null | cut -d= -f2-)
  EXISTING_PORT=$(grep '^SM_PORT=' "${ENV_FILE}" 2>/dev/null | cut -d= -f2-)

  if [ -n "${EXISTING_TOKEN}" ]; then
    echo "SM_EXISTING_TOKEN=${EXISTING_TOKEN}"
    echo "SM_EXISTING_PORT=${EXISTING_PORT:-9090}"
    info "=============================================="
    info " ${BINARY_NAME} 已在运行中, 跳过安装"
    info " 端口: ${EXISTING_PORT:-9090}"
    info " 如需强制重装, 请先卸载: bash install.sh --uninstall"
    info "=============================================="
    exit 0
  fi
fi

# ---- 记录是否需要热更新 ----
RUNNING_BEFORE=false
if systemctl is-active --quiet "${SERVICE_NAME}" 2>/dev/null; then
  RUNNING_BEFORE=true
  info "检测到已运行的服务, 将在更新后优雅重启 ..."
fi

# ---- 安装二进制 ----
if [ -n "${LOCAL_BINARY:-}" ]; then
  # 本地模式: 直接复制已有的二进制
  [ -f "${LOCAL_BINARY}" ] || error "本地文件不存在: ${LOCAL_BINARY}"
  info "使用本地二进制: ${LOCAL_BINARY}"
  cp "${LOCAL_BINARY}" "${INSTALL_DIR}/${BINARY_NAME}"
  chmod +x "${INSTALL_DIR}/${BINARY_NAME}"
else
  # 远程模式: 检测架构并下载
  detect_arch() {
    local arch
    arch="$(uname -m)"
    case "${arch}" in
      x86_64|amd64)   echo "amd64" ;;
      aarch64|arm64)   echo "arm64" ;;
      *)               error "不支持的架构: ${arch} (仅支持 amd64/arm64)" ;;
    esac
  }

  ARCH="$(detect_arch)"
  info "检测到架构: ${ARCH}"

  command -v curl >/dev/null 2>&1 || error "需要 curl, 请先安装: apt install curl / yum install curl"

  if [ -n "${DOWNLOAD_URL:-}" ]; then
    URL="${DOWNLOAD_URL}"
    info "使用自定义下载地址: ${URL}"
  else
    if [ "${VERSION}" = "latest" ]; then
      URL="https://github.com/${GITHUB_REPO}/releases/latest/download/${BINARY_NAME}-linux-${ARCH}"
    else
      URL="https://github.com/${GITHUB_REPO}/releases/download/${VERSION}/${BINARY_NAME}-linux-${ARCH}"
    fi
    info "从 GitHub Releases 下载: ${URL}"
  fi

  info "下载 ${BINARY_NAME} ..."
  TMP_FILE="$(mktemp)"
  HTTP_CODE=$(curl -fsSL -o "${TMP_FILE}" -w "%{http_code}" "${URL}" 2>/dev/null) || true

  if [ "${HTTP_CODE}" != "200" ] && [ "${HTTP_CODE}" != "302" ]; then
    rm -f "${TMP_FILE}"
    error "下载失败 (HTTP ${HTTP_CODE})。请检查 URL 是否正确: ${URL}"
  fi

  mv "${TMP_FILE}" "${INSTALL_DIR}/${BINARY_NAME}"
  chmod +x "${INSTALL_DIR}/${BINARY_NAME}"
fi

info "已安装到 ${INSTALL_DIR}/${BINARY_NAME}"

# ---- 写入环境配置 ----
info "写入配置 ${ENV_FILE} ..."
cat > "${ENV_FILE}" <<EOF
SM_TOKEN=${SM_TOKEN}
SM_PORT=${SM_PORT}
SM_GITHUB_REPO=${GITHUB_REPO}
EOF
chmod 600 "${ENV_FILE}"

# ---- 创建 systemd 服务 ----
info "创建 systemd 服务 ..."
cat > "${UNIT_FILE}" <<EOF
[Unit]
Description=Server Monitor Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=${ENV_FILE}
ExecStart=${INSTALL_DIR}/${BINARY_NAME}
ExecReload=/bin/kill -TERM \$MAINPID
Restart=always
RestartSec=1
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF

# ---- 启动/重启服务 ----
systemctl daemon-reload
systemctl enable "${SERVICE_NAME}" --quiet

if [ "${RUNNING_BEFORE}" = true ]; then
  info "优雅重启服务 ..."
  systemctl restart "${SERVICE_NAME}"
else
  info "启动服务 ..."
  systemctl start "${SERVICE_NAME}"
fi

# ---- 验证 ----
sleep 1
if systemctl is-active --quiet "${SERVICE_NAME}"; then
  info "=============================================="
  info " ${BINARY_NAME} 安装成功!"
  info " 端口: ${SM_PORT}"
  info " 状态: systemctl status ${SERVICE_NAME}"
  info " 日志: journalctl -u ${SERVICE_NAME} -f"
  info " 卸载: curl -sSL <url>/install.sh | bash -s -- --uninstall"
  info "=============================================="
else
  warn "服务启动可能失败, 请检查日志:"
  warn "  journalctl -u ${SERVICE_NAME} -n 20"
fi
