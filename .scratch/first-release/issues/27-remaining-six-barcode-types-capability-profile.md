# 27: 其余六种条码 capability profile

**What to build:** code39、code93、codabar、ean8、upca、itf 六种码制逐类型通过准入：bwip-js 生成的 IR 矩形经 zxing-wasm（Node）与 ZXing.Net（.NET）两个独立解码器读回，解码值、码制与物理尺寸等于声明；新模板严格校验值/长度/校验位；旧模板的 UPC-A→EAN13 与 ITF 奇数位补零等规范化以显式政策返回，不作为默认。未通过的类型在 capability profile 中标为不可用。

**Blocked by:** 11 Media Core：图片 + 条码（code128 / ean13）

**Status:** ready-for-agent

- [ ] 每种码制：正向样本、无效输入（字符集、长度、校验位）、边界尺寸/缩放、静区、pure、居中、列表值与循环场景
- [ ] 双解码器验收：zxing-wasm 与 ZXing.Net 均解出声明值与码制；解码器对 UPC-A/EAN13 的规范化行为记录，不误判
- [ ] 规范化政策：`BARCODE_NORMALIZED` 返回 `inputValue / encodedValue / normalizationPolicy`；ITF pure 参数行为显式
- [ ] capability profile 文件逐码制记录"通过 / 未通过 / Not verified"；未通过类型在能力发现接口中不可用
- [ ] 二维码/DataMatrix 明确不在范围
