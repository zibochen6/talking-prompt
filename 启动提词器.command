#!/bin/zsh
cd -- "${0:A:h}" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
    source "$HOME/.nvm/nvm.sh"
  elif [[ -d "$HOME/.nvm/versions/node" ]]; then
    for node_dir in "$HOME"/.nvm/versions/node/*/bin(NOn); do
      export PATH="$node_dir:$PATH"
      break
    done
  fi
fi
if ! command -v node >/dev/null 2>&1; then
  print "请先安装 Node.js 24 长期支持版：https://nodejs.org/"
  print "安装完成后，再次双击此文件。"
  read "?按回车关闭窗口…"
  exit 1
fi
node scripts/launch.mjs
result=$?
if [[ $result -ne 0 ]]; then
  print "提词器未能启动，请查看上方提示。"
  read "?按回车关闭窗口…"
fi
exit $result
