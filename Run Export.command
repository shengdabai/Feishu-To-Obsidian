#!/bin/zsh
cd -- "${0:A:h}" || exit 1
npm run export
result=$?
echo ""
echo "按任意键关闭..."
read -n 1
exit "$result"
