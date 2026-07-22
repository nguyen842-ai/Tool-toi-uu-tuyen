export default async function handler(req, res) {
    // 1. GẮN GIẤY THÔNG HÀNH CORS (Bắt buộc phải để trên cùng)
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*'); 
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    // 2. Trả lời trình duyệt khi nó "hỏi dò" (Preflight request)
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // 3. Chặn các request không phải POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Chỉ chấp nhận phương thức POST' });
    }

    try {
        const { locations, availableDays } = req.body;
        
        if (!locations || locations.length === 0) {
            return res.status(400).json({ error: 'Thiếu dữ liệu vị trí' });
        }

        // Tạo Prompt cho bài toán Phân tuyến theo Tuần
        const prompt = `Bạn là hệ thống AI điều phối kho vận (Logistics).
Dưới đây là danh sách khách hàng cần viếng thăm:
${JSON.stringify(locations)}

Danh sách các ca làm việc (Ngày) hiện có: ${availableDays.join(', ')}

NHIỆM VỤ CỦA BẠN:
1. Gom cụm: Gom toàn bộ khách hàng được gửi vào một rổ, sau đó nhặt những khách hàng gần nhau thành 1 cụm và trả về 1 ngày làm việc
2. Phân bổ đều: Cố gắng chia đều số lượng khách hàng cho các ngày trong danh sách ca làm việc.
3. Sắp xếp: Trong mỗi ngày, sắp xếp thứ tự viếng thăm sao cho quãng đường đi ngắn nhất.
4. Ràng buộc Output: TRẢ VỀ DUY NHẤT 1 mảng JSON thuần túy (không bọc trong markdown \`\`\`json, không giải thích). 

Cấu trúc JSON bắt buộc:
[
  { "id": "Mã khách hàng", "day": "Tên ngày mới được phân bổ", "order": thứ tự viếng thăm trong ngày }
]`;

        // Lấy danh sách chìa khóa
        const keysString = process.env.GEMINI_API_KEY; 
        if (!keysString) {
            return res.status(500).json({ error: 'Chưa cài đặt Keys trên Server' });
        }

        const apiKeys = keysString.split(',').map(key => key.trim()).filter(key => key.length > 0);
        let lastErrorData = null;
        let lastStatus = 500;

        // Xoay vòng chìa khóa
        for (let i = 0; i < apiKeys.length; i++) {
            const currentKey = apiKeys[i];
            
            // ĐÃ CẬP NHẬT MODEL LÊN PHIÊN BẢN 3.5 THEO YÊU CẦU
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${currentKey}`;
            
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
            });

            const data = await response.json();
            
            if (response.ok) {
                // Làm sạch JSON rác từ AI trước khi parse
                let textResponse = data.candidates[0].content.parts[0].text.trim();
                textResponse = textResponse.replace(/```json/gi, '').replace(/```/g, '').trim();
                
                const optimizedData = JSON.parse(textResponse);
                return res.status(200).json({ optimized_data: optimizedData });
            } 
            
            lastErrorData = data;
            lastStatus = response.status;
            
            const isQuotaError = response.status === 429 || (data.error && data.error.status === "RESOURCE_EXHAUSTED");
            if (isQuotaError) {
                console.log(`Key ${i+1} hết hạn mức, thử key tiếp theo...`);
                continue; 
            } else {
                return res.status(response.status).json(data);
            }
        }

        return res.status(lastStatus).json(lastErrorData || { error: 'Tất cả các key đều đã cạn kiệt.' });

    } catch (error) {
        console.error("Lỗi Server:", error);
        return res.status(500).json({ error: 'Lỗi hệ thống nội bộ Server' });
    }
}
