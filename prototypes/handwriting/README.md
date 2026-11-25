# 本地手写识别原型（#19）

在浏览器里本地识别手写的数字、罗马数字（I、V）、音名（A–G）和升降号，不联网、不用 WebAssembly、不用 eval。两种办法：

| 办法 | 文件 | 状态 |
| --- | --- | --- |
| 笔画模板（$P 点云匹配，BSD 许可） | `src/templates.js`、`src/pdollar.js` | 能用。手工模板加左右倾斜各一份，共 114 个；加了抖动的模板全部认对，多位数、IV、F♯ 都能正确切分，每次 2–8 ms |
| 小模型（两层卷积加两层全连接，int8 权重） | `train/train.py`、`src/cnn.js` | 代码写好，没有训练，`model/weights.json` 还不存在 |

共用的部分：`src/segment.js` 按笔画的横向重叠把一个答案切成一个个字符；`src/recognise.js` 按作答类型限定能出现的字符。`page.html` 和 `src/app.js` 是试验页：示例题加手写面板（触屏默认打开，键鼠默认收起）、采集样本、按设备统计识别率。

## 接着做

1. 在 Python 环境里装 `torch`、`torchvision`、`pillow`，运行 `python train/train.py <数据目录> model/weights.json`，会下载 MNIST 和 EMNIST（约 600 MB）。
2. `node eval.mjs check` 核对 JavaScript 推理和 PyTorch 的结果一致。
3. `node build.mjs` 生成 `dist/handwriting-lab.html`，在各设备上打开试写。
4. 采集到的样本导出成 JSON 数组后，`node eval.mjs samples <文件>` 算各设备、各办法的识别率。

数学的公式（上下标、分数线、积分上下限）要判断字符之间的位置关系，这个原型不处理；做数学输入时，由组件提供结构（分数的上下两格、上标格），手写只填一格里的一个字符。
