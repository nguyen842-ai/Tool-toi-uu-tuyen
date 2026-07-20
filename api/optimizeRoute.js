export default async function handler(req, res) {
    // 1. Cấu hình CORS Header (Cho phép Frontend từ domain khác gọi vào)
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*'); // Trong thực tế, bạn có thể thay '*' bằng 'https://nguyen842-ai.github.io'
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    // Phản hồi ngay lập tức cho các request Preflight (OPTIONS) của trình duyệt
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Chỉ chấp nhận POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { locations } = req.body;
        if (!locations || locations.length === 0) {
            return res.status(400).json({ error: 'Missing locations data' });
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'Gemini API Key is not configured on Vercel' });
        }

        const prompt = `Bạn là chuyên gia Logistics tối ưu hóa tuyến đường di chuyển. 
Dưới đây là mảng JSON chứa danh sách điểm đến bao gồm id, lat (vĩ độ), lng (kinh độ).
Nhiệm vụ: Sắp xếp lại thứ tự các id sao cho tổng quãng đường di chuyển ngắn nhất và logic nhất.
RÀNG BUỘC BẮT BUỘC: Điểm đầu tiên trong mảng dữ liệu đầu vào PHẢI LUÔN LÀ điểm xuất phát (giữ nguyên vị trí đầu tiên).
CHỈ TRẢ VỀ một mảng JSON thuần túy chứa danh sách các id đã sắp xếp theo thứ tự mới. Không giải thích, không dùng markdown.

Dữ liệu đầu vào:
${JSON.stringify(locations)}`;

        // 2. Gọi Model gemini-1.5-flash
        const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }]
            })
        });

        if (!geminiResponse.ok) {
            const err = await geminiResponse.json();
            console.error("Gemini API Error:", err);
            return res.status(500).json({ error: 'Failed to fetch from Gemini' });
        }

        const result = await geminiResponse.json();
        let textResponse = result.candidates[0].content.parts[0].text.trim();
        
        // 3. Làm sạch Markdown rác (nếu có) trước khi Parse
        textResponse = textResponse.replace(/```json/gi, '').replace(/```/g, '').trim();
        
        const optimizedIds = JSON.parse(textResponse);

        return res.status(200).json({ optimized_ids: optimizedIds });

    } catch (error) {
        console.error("Server Error:", error);
        return res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
}
