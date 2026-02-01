# EcoBacGiang API Server

Server Node.js riêng biệt sử dụng Express để phục vụ API cho cả website Next.js và mobile app.

## Cấu trúc thư mục

```
server/
├── config/          # Cấu hình (database, etc.)
├── middleware/      # Middleware (auth, etc.)
├── models/          # Mongoose models
├── routes/          # API routes
├── utils/           # Utilities (sendEmails, tokens, etc.)
├── .env.example     # File mẫu cho biến môi trường
├── package.json     # Dependencies
├── server.js        # File chính của server
└── README.md        # Tài liệu này
```

## Cài đặt

1. **Cài đặt dependencies:**
```bash
cd server
npm install
```

2. **Cấu hình biến môi trường:**
```bash
cp .env.example .env
# Sau đó chỉnh sửa file .env với các giá trị thực tế của bạn
```

3. **Chạy server:**
```bash
# Development mode (với nodemon để auto-reload)
npm run dev

# Production mode
npm start
```

Server sẽ chạy tại `http://localhost:5000` (hoặc port được cấu hình trong `.env`)

## API Endpoints

### Authentication
- `POST /api/auth/signup` - Đăng ký tài khoản mới
- `POST /api/auth/signin` - Đăng nhập
- `POST /api/auth/verify-email-otp` - Xác nhận email bằng OTP
- `POST /api/auth/resend-email-otp` - Gửi lại mã OTP

### Products
- `GET /api/products` - Lấy danh sách sản phẩm
- `GET /api/products/:slug` - Lấy sản phẩm theo slug
- `POST /api/products` - Tạo sản phẩm mới (cần auth)
- `PUT /api/products/:id` - Cập nhật sản phẩm (cần auth)
- `DELETE /api/products/:id` - Xóa sản phẩm (cần auth)

### Cart
- `GET /api/cart?userId=xxx` - Lấy giỏ hàng của user
- `POST /api/cart` - Thêm sản phẩm vào giỏ hàng
- `PUT /api/cart/:userId/:productId` - Cập nhật số lượng
- `DELETE /api/cart/:userId/:productId` - Xóa sản phẩm khỏi giỏ hàng

### Orders
- `GET /api/orders` - Lấy danh sách đơn hàng (cần auth)
- `GET /api/orders/:id` - Lấy chi tiết đơn hàng (cần auth)

### User
- `GET /api/user/me` - Lấy thông tin user hiện tại (cần auth)
- `GET /api/user/:userId` - Lấy thông tin user theo ID
- `PUT /api/user/:userId` - Cập nhật thông tin user (cần auth)

### Wishlist
- `GET /api/wishlist` - Lấy danh sách yêu thích (cần auth)
- `POST /api/wishlist/:productId` - Thêm vào danh sách yêu thích (cần auth)
- `DELETE /api/wishlist/:productId` - Xóa khỏi danh sách yêu thích (cần auth)

### Address
- `GET /api/address` - Lấy danh sách địa chỉ (cần auth)
- `POST /api/address` - Thêm địa chỉ mới (cần auth)
- `PUT /api/address/:index` - Cập nhật địa chỉ (cần auth)
- `DELETE /api/address/:index` - Xóa địa chỉ (cần auth)

### Checkout
- `POST /api/checkout` - Tạo đơn hàng từ giỏ hàng (cần auth)

### Coupon
- `GET /api/coupon` - Lấy danh sách coupon hoặc validate coupon code
- `GET /api/coupon?code=XXX` - Validate coupon code

### Subscription
- `POST /api/subscription` - Đăng ký nhận email
- `POST /api/subscription/unsubscribe` - Hủy đăng ký

### Survey
- `POST /api/survey` - Gửi kết quả khảo sát

### Posts
- `GET /api/posts` - Lấy danh sách bài viết
- `GET /api/posts/:postId` - Lấy chi tiết bài viết

### Chat
- `POST /api/chat` - Gửi tin nhắn đến chatbot

## Authentication

Server hỗ trợ JWT authentication cho mobile app:

1. Đăng nhập qua `/api/auth/signin` để nhận JWT token
2. Gửi token trong header: `Authorization: Bearer <token>`
3. Các routes được bảo vệ bằng middleware `withAuth` sẽ yêu cầu token hợp lệ

## CORS

Server được cấu hình để cho phép CORS từ các origins được chỉ định trong biến môi trường `ALLOWED_ORIGINS`.

## Database

Server sử dụng MongoDB với Mongoose. Đảm bảo MongoDB đang chạy và `MONGODB_URI` được cấu hình đúng trong file `.env`.

## Tích hợp với Next.js Website

Để sử dụng API server này với Next.js website, bạn có thể:

1. Cập nhật các API calls trong Next.js để trỏ đến server này
2. Hoặc giữ nguyên API routes trong Next.js và chỉ dùng server này cho mobile app

## Tích hợp với Mobile App

Mobile app có thể gọi trực tiếp các API endpoints từ server này. Đảm bảo:

1. Cấu hình base URL của API trong mobile app
2. Lưu JWT token sau khi đăng nhập
3. Gửi token trong header `Authorization` cho các requests cần authentication

## Development

- Sử dụng `npm run dev` để chạy với nodemon (auto-reload khi có thay đổi)
- Logs được hiển thị trong console
- Health check endpoint: `GET /health`

## Production

- Sử dụng `npm start` để chạy production mode
- Đảm bảo cấu hình đúng các biến môi trường
- Có thể sử dụng PM2 hoặc các process manager khác để quản lý server

## Notes

- Server này được thiết kế để tương thích với các API routes hiện có trong Next.js
- Các models và logic được giữ nguyên để đảm bảo tính nhất quán
- Có thể mở rộng thêm các routes và tính năng khi cần

