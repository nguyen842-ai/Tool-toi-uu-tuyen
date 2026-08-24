export default async function handler(req, res) {
    // 1. GẮN GIẤY THÔNG HÀNH CORS (Chuẩn hóa)
    res.setHeader('Access-Control-Allow-Origin', '*'); 
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    // Phản hồi ngay Preflight Request của trình duyệt
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Chỉ chấp nhận phương thức POST' });

    try {
        const { currentData, command, availableDays } = req.body;
        
        if (!currentData || !command || !availableDays) {
            return res.status(400).json({ error: 'Thiếu dữ liệu đầu vào để tinh chỉnh tuyến.' });
        }

        const prompt = `Bạn là Trợ lý tinh chỉnh lộ trình. 
Lộ trình hiện tại: ${JSON.stringify(currentData)}. 
Yêu cầu quản lý: "${command}". 
Ngày hợp lệ: ${availableDays.join(', ')}.

NHIỆM VỤ: 
1. Thực hiện đúng yêu cầu điều chỉnh ngày/thứ tự của quản lý. Điểm không bị ảnh hưởng thì giữ nguyên ngày cũ. 
2. Sau đó, tự sắp xếp lại "order" từ 1 cho các điểm trong từng ngày sao cho đường đi ngắn nhất. 
3. Tuyệt đối giữ nguyên giá trị "freq" của từng mã KH.
4. Trả về DUY NHẤT một mảng JSON các object với cấu trúc: [{"id": "Mã KH", "day": "Tên ngày", "order": thứ tự bắt đầu từ 1, "freq": "Giữ nguyên freq cũ"}]`;

        const keysString = process.env.GEMINI_API_KEY;
        if (!keysString) {
            return res.status(500).json({ error: 'Chưa cấu hình GEMINI_API_KEY trên hệ thống Vercel.' });
        }

        const apiKeys = keysString.split(',').map(key => key.trim()).filter(Boolean);
        let lastErrorData = null; 
        let lastStatus = 500;

        // Vòng lặp xoay vòng API Key thông minh
        for (let i = 0; i < apiKeys.length; i++) {
            const currentKey = apiKeys[i];
            
            // Sử dụng gemini-1.5-flash (Model chuẩn, tốc độ siêu tốc hiện tại)
            const apiUrl = `[https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=$](https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=$){currentKey}`;
            
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        response_mime_type: "application/json", // Ép Gemini trả về JSON thuần
                        temperature: 0.1 // Nhiệt độ thấp để trả lời mang tính logic chính xác nhất
                    }
                })
            });
            
            const data = await response.json();

            // Nếu thành công -> Parse và trả về luôn
            if (response.ok) {
                const textResponse = data.candidates[0].content.parts[0].text;
                return res.status(200).json({ modified_data: JSON.parse(textResponse) });
            }
            
            lastErrorData = data; 
            lastStatus = response.status;
            
            // Nếu lỗi do hết Quota (429) -> Bỏ qua và thử Key tiếp theo
            const isQuotaError = response.status === 429 || (data.error && data.error.status === "RESOURCE_EXHAUSTED");
            if (isQuotaError) {
                console.log(`Key ${i+1} hết hạn mức, đang đổi sang key tiếp theo...`);
                continue; 
            } else {
                // Nếu lỗi khác (ví dụ sai API key, lỗi nội dung) -> Dừng vòng lặp và báo lỗi
                return res.status(response.status).json(data);
            }
        }
        
        // Nếu chạy hết vòng lặp mà vẫn không thành công
        return res.status(lastStatus).json(lastErrorData || { error: 'Tất cả các API key đều bị lỗi hoặc hết hạn mức.' });
        
    } catch (error) {
        console.error("Lỗi Server Modify:", error);
        return res.status(500).json({ error: 'Lỗi hệ thống nội bộ Server.' });
    }
}
