# 本地声控模型

这个目录存放流式 Zipformer 中英双语 int8 模型，供 Mac 应用在本机识别朗读。模型文件不纳入 Git。

需要这四个文件：

- `encoder-epoch-99-avg-1.int8.onnx`
- `decoder-epoch-99-avg-1.int8.onnx`
- `joiner-epoch-99-avg-1.int8.onnx`
- `tokens.txt`

在仓库根目录运行 `npm run voice:model` 会从 Hugging Face 下载它们。已经放在 `.qa/model/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20/` 的同一套文件也会被开发时的应用找到。打包 Mac 安装包时，若这些文件存在，会放进应用资源；int8 模型大约增加 200MB。
