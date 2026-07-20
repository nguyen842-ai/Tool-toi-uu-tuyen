export default async function handler(req, res) {
    // Chỉ chấp nhận phương thức POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { locations } = req.body;
        if (!locations || locations.length === 0) {
            return res.status(400).json({ error: 'Missing locations data' });
        }

        // Lấy API Key từ biến môi trường Vercel
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'Gemini API Key is not configured on Vercel' });
        }

        // Tạo prompt ép Gemini trả về kết quả JSON chính xác
        const prompt = `Bạn là chuyên gia Logistics tối ưu hóa tuyến đường di chuyển. 
Dưới đây là mảng JSON chứa danh sách điểm đến bao gồm id, lat (vĩ độ), lng (kinh độ).
Nhiệm vụ: Sắp xếp lại thứ tự các id sao cho tổng quãng đường di chuyển ngắn nhất và logic nhất.
RÀNG BUỘC BẮT BUỘC: Điểm đầu tiên trong mảng dữ liệu đầu vào PHẢI LUÔN LÀ điểm xuất phát (giữ nguyên vị trí đầu tiên).
CHỈ TRẢ VỀ một mảng JSON thuần túy chứa danh sách các id đã sắp xếp theo thứ tự mới. Không giải thích, không dùng markdown (\`\`\`json).

Dữ liệu đầu vào:
${JSON.stringify(locations)}`;

        // Gọi API của Gemini (Dòng mô hình gemini-2.5-flash)
        const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });

        const result = await geminiResponse.json();
        
        // Trích xuất văn bản trả về từ Gemini
        const textResponse = result.candidates[0].content.parts[0].text.trim();
        
        // Parse chuỗi nhận được thành mảng JSON để trả về cho Frontend
        const optimizedIds = JSON.parse(textResponse);

        return res.status(200).json({ optimized_ids: optimizedIds });

    } catch (error) {
        console.error("Error optimizing route:", error);
        return res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
}
