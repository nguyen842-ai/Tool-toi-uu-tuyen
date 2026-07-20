export default async function handler(req, res) {
    // 1. CÀI ĐẶT CẤU HÌNH CORS (Giấy thông hành cho Frontend gọi API)
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*'); 
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    // Phản hồi nhanh cho yêu cầu hỏi dò (Preflight Request) từ trình duyệt
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Chỉ chấp nhận phương thức POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Chỉ chấp nhận phương thức POST' });
    }

    try {
        const { currentData, command, availableDays } = req.body;

        if (!currentData || !command || !availableDays) {
            return res.status(400).json({ error: 'Thiếu dữ liệu đầu vào để tinh chỉnh tuyến (currentData, command, hoặc availableDays).' });
        }

        // 2. XÂY DỰNG PROMPT AI - ĐỌC HIỂU LỆNH CHAT VÀ TINH CHỈNH TUYẾN
        const prompt = `Bạn là Trợ lý tinh chỉnh lộ trình Logistics thông minh (Vehicle Routing Problem).
Dưới đây là danh sách lộ trình hiện tại của nhân viên (bao gồm mã khách hàng, ngày hiện tại và tọa độ):
${JSON.stringify(currentData)}

Yêu cầu điều chỉnh đặc biệt từ người quản lý: "${command}"
Danh sách các ngày làm việc hợp lệ được phép phân bổ: ${availableDays.join(', ')}

NHIỆM VỤ CỦA BẠN:
1. Thực hiện chính xác yêu cầu điều chỉnh từ người quản lý (ví dụ: dời một vài mã khách hàng cụ thể sang thứ khác, đổi thứ tự ghé thăm...).
2. Đối với những khách hàng KHÔNG bị ảnh hưởng trực tiếp bởi câu lệnh, hãy GIỮ NGUYÊN ngày ("day") cũ của họ. 
3. Sắp xếp lại thứ tự di chuyển: Sau khi điều chỉnh, hãy tự động sắp xếp lại trường "order" (thứ tự viếng thăm bắt đầu từ 1) cho TẤT CẢ các khách hàng trong từng ngày, sao cho chuỗi lộ trình nối đuôi nhau ngắn nhất, tối ưu nhất dựa trên tọa độ (lat, lng), tránh đi ziczac.
4. Ràng buộc ngày: Đảm bảo toàn bộ dữ liệu trả về chỉ gồm các ngày nằm trong danh sách các ngày làm việc hợp lệ.
5. Định dạng đầu ra nghiêm ngặt: Trả về DUY NHẤT một mảng JSON thuần túy gồm các đối tượng, không bọc markdown \`\`\`json, không giải thích dài dòng.

Cấu trúc JSON đầu ra bắt buộc:
[
  { "id": "Mã khách hàng", "day": "Tên ngày sau điều chỉnh", "order": thứ tự mới trong ngày bắt đầu từ 1 }
]`;

        // 3. XOAY VÒNG API KEYS TỰ ĐỘNG DỰ PHÒNG LỖI QUÁ TẢI
        const keysString = process.env.GEMINI_API_KEYS;
        if (!keysString) {
            return res.status(500).json({ error: 'Chưa cấu hình GEMINI_API_KEYS trên hệ thống Vercel.' });
        }

        const apiKeys = keysString.split(',').map(key => key.trim()).filter(Boolean);
        let lastErrorData = null;
        let lastStatus = 500;

        for (let i = 0; i < apiKeys.length; i++) {
            const currentKey = apiKeys[i];
            
            // SỬ DỤNG PHIÊN BẢN 3.5 FLASH MỚI NHẤT
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${currentKey}`;
            
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
            });

            const data = await response.json();

            if (response.ok) {
                // Làm sạch chuỗi JSON nếu AI vô tình trả về định dạng văn bản bọc block code
                let textResponse = data.candidates[0].content.parts[0].text.trim();
                textResponse = textResponse.replace(/```json/gi, '').replace(/```/g, '').trim();
                
                const modifiedData = JSON.parse(textResponse);
                return res.status(200).json({ modified_data: modifiedData });
            }

            lastErrorData = data;
            lastStatus = response.status;

            // Nếu gặp lỗi cạn hạn mức 429, nhảy sang key tiếp theo ngay
            const isQuotaError = response.status === 429 || (data.error && data.error.status === "RESOURCE_EXHAUSTED");
            if (isQuotaError) {
                console.warn(`Key thứ ${i + 1} hết hạn mức, hệ thống tự động đổi key...`);
                continue;
            } else {
                return res.status(response.status).json(data);
            }
        }

        return res.status(lastStatus).json(lastErrorData || { error: 'Tất cả các API key tinh chỉnh đều gặp lỗi hoặc hết hạn mức.' });

    } catch (error) {
        console.error("Lỗi Server tinh chỉnh tuyến:", error);
        return res.status(500).json({ error: 'Lỗi hệ thống nội bộ Server khi xử lý tinh chỉnh lộ trình.' });
    }
}
