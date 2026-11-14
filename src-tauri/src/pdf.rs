//! Single-page PDF holding an RGB image (FlateDecode). Transparency is composited over white.
use flate2::write::ZlibEncoder;
use flate2::Compression;
use std::io::Write;

pub fn rgba_to_rgb_over_white(rgba: &[u8]) -> Vec<u8> {
    let mut rgb = Vec::with_capacity(rgba.len() / 4 * 3);
    for px in rgba.chunks_exact(4) {
        let a = px[3] as u32;
        for c in 0..3 {
            rgb.push(((px[c] as u32 * a + 255 * (255 - a) + 127) / 255) as u8);
        }
    }
    rgb
}

pub fn create_image_pdf(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>, String> {
    if width == 0 || height == 0 || rgba.len() != width as usize * height as usize * 4 {
        return Err("Données de l’image PDF invalides.".into());
    }
    let rgb = rgba_to_rgb_over_white(rgba);
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(&rgb).map_err(|e| e.to_string())?;
    let data = encoder.finish().map_err(|e| e.to_string())?;
    // 96 dpi pixels → points.
    let (w, h) = (width as f64 * 0.75, height as f64 * 0.75);
    let content = format!("q\n{w:.4} 0 0 {h:.4} 0 0 cm\n/Im0 Do\nQ\n");
    let mut image = format!("<< /Type /XObject /Subtype /Image /Width {width} /Height {height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length {} >>\nstream\n", data.len()).into_bytes();
    image.extend_from_slice(&data);
    image.extend_from_slice(b"\nendstream");
    let objects: Vec<Vec<u8>> = vec![
        b"<< /Type /Catalog /Pages 2 0 R >>".to_vec(),
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_vec(),
        format!("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {w:.4} {h:.4}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>").into_bytes(),
        image,
        [format!("<< /Length {} >>\nstream\n", content.len()).into_bytes(), content.into_bytes(), b"endstream".to_vec()].concat(),
    ];
    let mut out = b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n".to_vec();
    let mut offsets = Vec::new();
    for (i, body) in objects.iter().enumerate() {
        offsets.push(out.len());
        out.extend_from_slice(format!("{} 0 obj\n", i + 1).as_bytes());
        out.extend_from_slice(body);
        out.extend_from_slice(b"\nendobj\n");
    }
    let xref = out.len();
    out.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).as_bytes());
    for offset in offsets {
        out.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
    }
    out.extend_from_slice(format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n", objects.len() + 1).as_bytes());
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pdf_structure() {
        let pdf = create_image_pdf(2, 1, &[255, 0, 0, 255, 0, 0, 255, 0]).unwrap();
        let text = String::from_utf8_lossy(&pdf);
        assert!(text.starts_with("%PDF-1.4"));
        assert!(text.contains("/Width 2 /Height 1"));
        assert!(text.trim_end().ends_with("%%EOF"));
        assert_eq!(rgba_to_rgb_over_white(&[0, 0, 0, 0]), vec![255, 255, 255]);
        assert_eq!(rgba_to_rgb_over_white(&[10, 20, 30, 255]), vec![10, 20, 30]);
    }
}
