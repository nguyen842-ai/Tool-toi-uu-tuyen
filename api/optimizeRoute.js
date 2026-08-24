// Tính khoảng cách giữa 2 tọa độ (Haversine Formula)
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; 
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// Thuật toán K-Means: Gom khách hàng thành cụm
function kMeansClustering(locations, k, maxIterations = 50) {
    if (locations.length <= k) return locations.map((_, i) => i);
    
    let centroids = locations.slice(0, k).map(l => ({ lat: l.lat, lng: l.lng }));
    let assignments = new Array(locations.length).fill(0);
    let changed = true;
    let iterations = 0;

    while (changed && iterations < maxIterations) {
        changed = false; iterations++;
        for (let i = 0; i < locations.length; i++) {
            let minDist = Infinity; let cluster = 0;
            for (let j = 0; j < k; j++) {
                let dist = getDistance(locations[i].lat, locations[i].lng, centroids[j].lat, centroids[j].lng);
                if (dist < minDist) { minDist = dist; cluster = j; }
            }
            if (assignments[i] !== cluster) { assignments[i] = cluster; changed = true; }
        }
        
        let newCentroids = Array.from({ length: k }, () => ({ lat: 0, lng: 0, count: 0 }));
        for (let i = 0; i < locations.length; i++) {
            let c = assignments[i];
            newCentroids[c].lat += locations[i].lat;
            newCentroids[c].lng += locations[i].lng;
            newCentroids[c].count++;
        }
        for (let j = 0; j < k; j++) {
            if (newCentroids[j].count > 0) {
                centroids[j].lat = newCentroids[j].lat / newCentroids[j].count;
                centroids[j].lng = newCentroids[j].lng / newCentroids[j].count;
            }
        }
    }
    return assignments;
}

export default async function handler(req, res) {
    // 1. GẮN GIẤY THÔNG HÀNH CORS (Chuẩn hóa)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    // 2. ÉP KIỂU JSON AN TOÀN (Sửa dứt điểm lỗi 400 Bad Request)
    let body = req.body;
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } 
        catch (e) { return res.status(400).json({ error: 'Lỗi parse JSON đầu vào' }); }
    }

    // Xử lý nút Ping (Trả về 200 OK)
    if (body && body.ping) return res.status(200).json({ message: 'Server OK', status: 'ok' });

    try {
        const { locations, availableDays } = body || {};
        
        if (!locations || !Array.isArray(locations) || !availableDays || availableDays.length === 0) {
            return res.status(400).json({ error: 'Dữ liệu không hợp lệ. Gửi thiếu locations hoặc availableDays.' });
        }

        // =====================================================================
        // BƯỚC 1: TIỀN XỬ LÝ BẰNG THUẬT TOÁN (K-MEANS + NEAREST NEIGHBOR)
        // =====================================================================
        const k = Math.min(availableDays.length, locations.length);
        const assignments = kMeansClustering(locations, k);
        let algorithmicData = [];

        for (let c = 0; c < k; c++) {
            let clusterLocs = locations.filter((_, idx) => assignments[idx] === c);
            if (clusterLocs.length === 0) continue;

            let targetDay = availableDays[c];
            let unvisited = [...clusterLocs];
            let currentLoc = unvisited.shift();
            let order = 1;

            algorithmicData.push({ id: currentLoc.id, day: targetDay, order: order++, freq: currentLoc.currentFreq || 'F4' });

            while (unvisited.length > 0) {
                let nearestIdx = 0, minDist = Infinity;
                for (let j = 0; j < unvisited.length; j++) {
                    let d = getDistance(currentLoc.lat, currentLoc.lng, unvisited[j].lat, unvisited[j].lng);
                    if (d < minDist) { minDist = d; nearestIdx = j; }
                }
                currentLoc = unvisited.splice(nearestIdx, 1)[0];
                algorithmicData.push({ id: currentLoc.id, day: targetDay, order: order++, freq: currentLoc.currentFreq || 'F4' });
            }
        }

        // =====================================================================
        // BƯỚC 2: GỬI LÊN GEMINI AI ĐỂ TINH CHỈNH (CÓ XOAY VÒNG KEY)
        // =====================================================================
        const keysString = process.env.GEMINI_API_KEY; 
        
        if (!keysString) {
            // Chạy dự phòng (Fallback) nếu chưa cấu hình Key
            return res.status(200).json({ message: 'Tối ưu bằng Thuật toán (Chưa có API Key)', optimized_data: algorithmicData });
        }

        const prompt = `Bạn là chuyên gia quy hoạch lộ trình bán hàng (DSD Routing).
Dưới đây là danh sách khách hàng đã được nhóm theo ngày và sắp xếp sơ bộ:
${JSON.stringify(algorithmicData)}

Nhiệm vụ của bạn:
1. Đánh giá lại thứ tự (order) của các điểm giao trong cùng một ngày (day).
2. Tinh chỉnh lại thứ tự (order) nếu thấy thuật toán sắp xếp chưa thực sự tối ưu về mặt con người. TUYỆT ĐỐI không thay đổi mã 'id', 'day', 'freq'.
3. Trả về DUY NHẤT mảng JSON thuần túy gồm các Object: [{"id": "...", "day": "...", "order": ..., "freq": "..."}].
4. KHÔNG giải thích, KHÔNG dùng markdown chứa \`\`\`json.`;

        const apiKeys = keysString.split(',').map(key => key.trim()).filter(Boolean);
        let lastErrorData = null;

        for (let i = 0; i < apiKeys.length; i++) {
            const currentKey = apiKeys[i];
            try {
                const aiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${currentKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: { 
                            response_mime_type: "application/json",
                            temperature: 0.1 
                        }
                    })
                });

                const aiData = await aiResponse.json();

                if (aiResponse.ok) {
                    const aiText = aiData.candidates[0].content.parts[0].text;
                    const finalOptimizedData = JSON.parse(aiText);
                    return res.status(200).json({
                        message: 'Tối ưu thành công bằng Hybrid AI',
                        optimized_data: finalOptimizedData
                    });
                }
                
                // Nếu lỗi Quota thì bỏ qua vòng này để thử Key tiếp theo
                const isQuotaError = aiResponse.status === 429 || (aiData.error && aiData.error.status === "RESOURCE_EXHAUSTED");
                if (isQuotaError) {
                    console.log(`Key thứ ${i+1} hết hạn mức, đang đổi sang key tiếp theo...`);
                    continue;
                } else {
                    lastErrorData = aiData;
                    break;
                }

            } catch (e) { lastErrorData = e; break; }
        }

        // Nếu tất cả AI Keys đều sập hoặc lỗi, TỰ ĐỘNG fallback về kết quả K-Means thuật toán (Bảo hiểm 2 lớp)
        console.warn("Lỗi Gemini AI, tự động chuyển về kết quả thuật toán:", lastErrorData);
        return res.status(200).json({
            message: 'Tối ưu bằng Thuật toán (AI Timeout/Lỗi)',
            optimized_data: algorithmicData
        });

    } catch (error) {
        console.error('Lỗi Internal Route:', error);
        return res.status(500).json({ error: 'Lỗi Internal Server Error' });
    }
}
