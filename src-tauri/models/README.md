# Bundled portrait segmentation

`u2netp.onnx` is the small U2Net model from https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx (upstream MD5 `8e83ca70e441ab06c318d82300c84806`). Model architecture and weights: https://github.com/xuebinqin/U-2-Net, Apache 2.0; license included alongside this file.

Preprocessing follows the reference U2Netp session: RGB resized to 320x320, divided by the maximum channel value, normalized by ImageNet channel mean/std. The first output mask is normalized and resized to the source dimensions. Native code applies it only to alpha; source RGB pixels are preserved.

Reference: https://github.com/danielgatis/rembg/blob/main/rembg/sessions/u2netp.py and `base.py` in the same directory.

The fixed graph adapter in `portrait.rs` materializes resize scales and uses equivalent half-pixel coordinates for this model's fixed spatial shapes. These changes work around tract 0.21's empty-scale handling and unsupported `pytorch_half_pixel` spelling. This is specific to the bundled model, not a general-purpose ONNX converter.

Inference is native CPU processing, outside the UI thread. The model is embedded in the executable and never downloaded during login. Character portraits are downloaded only from EVE's public image server, processed locally, and cached by source-image SHA-256 and model version. Cache failures do not prevent displaying a freshly processed cutout.
