---
title: 订单接口文档
docId: TRADE-API-004
bizLine: trade
securityLevel: internal
owner: 交易产品组 / 张三
version: v2.0
updatedAt: 2026-07-12
tags: [API, 订单, 退款, 接口, 交易]
---

# 订单接口文档

> 基础路径：`/api/v1/trade`。需登录态，请求头携带 `Authorization: Bearer <token>`。
> 接口返回格式：`{ "code": 0, "message": "success", "data": { ... } }`。

---

## 接口 1：创建订单

创建订单，触发价格试算、风控校验、库存预占、拆单后写入数据库。

### 请求

| 项 | 值 |
|---|---|
| HTTP 方法 | POST |
| 路径 | `/api/v1/trade/order/create` |
| Content-Type | application/json |

### 请求参数

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| items | array | 是 | 购买商品列表，每个元素包含 `skuId`、`qty` |
| addressId | string | 是 | 收货地址 ID，从地址管理接口获取 |
| couponIds | array | 否 | 使用的优惠券 ID 列表，可不传 |
| usePoints | boolean | 否 | 是否使用积分抵扣，默认 false |
| payAmount | string | 是 | 前端展示的应付金额，与后端试算比对，防篡改 |
| buyerRemark | string | 否 | 买家备注，最多 200 字符 |
| requestId | string | 是 | 前端下单幂等令牌，UUID 格式，5 秒内重复请求返回同一订单号 |

### 响应示例

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "orderNo": "YL202608110000000001",
    "payAmount": "199.00",
    "payParams": {
      "channel": "WECHAT",
      "prepayId": "wx20161130105706666666",
      "nonceStr": "abc123",
      "timeStamp": "1723350000",
      "signType": "MD5",
      "paySign": "xxxxxx"
    },
    "subOrders": [
      {
        "orderNo": "YL202608110000000001-001",
        "merchantId": 1001,
        "payAmount": "150.00",
        "items": [
          { "skuId": 2001, "skuName": "云集定制T恤-白色-M", "price": "79.00", "qty": 1, "itemPayAmount": "79.00" },
          { "skuId": 2002, "skuName": "云集定制T恤-黑色-M", "price": "71.00", "qty": 1, "itemPayAmount": "71.00" }
        ]
      },
      {
        "orderNo": "YL202608110000000001-002",
        "merchantId": 1002,
        "payAmount": "49.00",
        "items": [
          { "skuId": 3001, "skuName": "云集帆布包-米色", "price": "49.00", "qty": 1, "itemPayAmount": "49.00" }
        ]
      }
    ]
  }
}
```

### 错误码

| 错误码 | 说明 |
|---|---|
| ORD_PRICE_CHANGED | 商品价格已变动，请刷新页面确认 |
| ORD_STOCK_LACK | 库存不足 |
| ORD_RISK_REJECT | 风控拦截，本次交易受限 |
| ORD_COUPON_INVALID | 优惠券已失效或不可用 |
| ORD_DUPLICATE_REQUEST | 重复请求，已在 5 秒内下单 |
| ORD_LIMIT_EXCEEDED | 超过限购数量 |

---

## 接口 2：查询订单详情

### 请求

| 项 | 值 |
|---|---|
| HTTP 方法 | GET |
| 路径 | `/api/v1/trade/order/detail` |

### 请求参数

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| orderNo | string | 是 | 订单号，支持父订单号和子订单号 |

### 响应示例

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "orderNo": "YL202608110000000001",
    "status": 10,
    "statusName": "待付款",
    "totalAmount": "299.00",
    "freightAmount": "10.00",
    "discountAmount": "50.00",
    "payAmount": "259.00",
    "paidAmount": "0.00",
    "refundedAmount": "0.00",
    "createTime": "2026-08-11 14:30:00",
    "payTime": null,
    "receiverName": "张**",
    "receiverPhone": "138****1234",
    "receiverAddress": "北京市朝阳区***",
    "items": [
      {
        "skuId": 2001,
        "skuName": "云集定制T恤-白色-M",
        "price": "79.00",
        "qty": 1,
        "itemPayAmount": "79.00",
        "imageUrl": "https://img.yunli.com/2001.jpg"
      }
    ],
    "statusLogs": [
      { "fromStatus": 0, "toStatus": 10, "operator": "系统", "operateTime": "2026-08-11 14:30:00", "eventSource": "ORDER_CREATE" }
    ]
  }
}
```

---

## 接口 3：查询订单列表

### 请求

| 项 | 值 |
|---|---|
| HTTP 方法 | GET |
| 路径 | `/api/v1/trade/order/list` |

### 请求参数

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| status | int | 否 | 订单状态筛选，传空查全部 |
| keyword | string | 否 | 搜索关键词，匹配订单号或商品名称，模糊搜索 |
| startTime | string | 否 | 下单开始时间，格式 yyyy-MM-dd HH:mm:ss |
| endTime | string | 否 | 下单结束时间 |
| page | int | 否 | 页码，默认 1 |
| pageSize | int | 否 | 每页条数，默认 20，最大 50 |

### 响应示例

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "total": 156,
    "page": 1,
    "pageSize": 20,
    "list": [
      {
        "orderNo": "YL202608110000000001",
        "status": 10,
        "statusName": "待付款",
        "payAmount": "259.00",
        "itemCount": 3,
        "createTime": "2026-08-11 14:30:00"
      }
    ]
  }
}
```

---

## 接口 4：取消订单

### 请求

| 项 | 值 |
|---|---|
| HTTP 方法 | POST |
| 路径 | `/api/v1/trade/order/cancel` |

### 请求参数

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| orderNo | string | 是 | 要取消的订单号 |
| cancelReason | string | 否 | 取消原因，可选：BUYER_CHANGE_MIND / BUYER_DUPLICATE_ORDER / BUYER_OTHER |
| remark | string | 否 | 取消备注，最多 200 字符 |

### 响应示例

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "orderNo": "YL202608110000000001",
    "newStatus": 60,
    "newStatusName": "已取消"
  }
}
```

### 错误码

| 错误码 | 说明 |
|---|---|
| ORD_STATUS_INVALID | 当前订单状态不允许取消 |
| ORD_ALREADY_PAID | 订单已支付，请走退款流程 |
| ORD_NOT_FOUND | 订单不存在或无权操作 |

---

## 接口 5：申请退款

### 请求

| 项 | 值 |
|---|---|
| HTTP 方法 | POST |
| 路径 | `/api/v1/trade/refund/apply` |

### 请求参数

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| orderNo | string | 是 | 订单号，支持子订单号 |
| refundType | string | 是 | 退款类型：REFUND_ONLY / RETURN_REFUND / EXCHANGE |
| items | array | 是 | 退款商品明细，每个元素包含 `skuId`、`qty` |
| refundAmount | string | 是 | 申请退款金额，不可超过可退金额 |
| reason | string | 是 | 退款原因，可选：QUALITY_ISSUE / NOT_AS_DESCRIBED / SIZE_NOT_FIT / COLOR_NOT_MATCH / DELIVERY_LATE / NO_NEED / OTHER |
| description | string | 否 | 退款原因描述，最多 500 字 |
| images | array | 否 | 凭证图片 URL 列表，最多 9 张，质量问题建议上传 |
| returnTrackingNo | string | 否 | 退货退款场景：回寄物流单号，商家同意后回填 |

### 响应示例

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "refundOrderNo": "RF202608110000000001",
    "refundType": "REFUND_ONLY",
    "refundAmount": "79.00",
    "status": 100,
    "statusName": "待审核",
    "autoApproved": true,
    "expectedArrivalDesc": "预计 1-3 个工作日到账"
  }
}
```

### 错误码

| 错误码 | 说明 |
|---|---|
| RF_ORDER_STATUS_INVALID | 订单状态不允许退款 |
| RF_TIMEOUT | 超过售后申请时效 |
| RF_DUPLICATE | 该商品已有处理中的退款单 |
| RF_AMOUNT_EXCEED | 申请金额超过可退金额 |
| RF_CATEGORY_FORBID | 该商品类目不支持退款 |
| RF_RISK_BLACKLIST | 退款申请被风控拦截 |

---

## 接口 6：查询退款进度

### 请求

| 项 | 值 |
|---|---|
| HTTP 方法 | GET |
| 路径 | `/api/v1/trade/refund/progress` |

### 请求参数

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| refundOrderNo | string | 是 | 退款单号 |
| orderNo | string | 否 | 订单号，与 refundOrderNo 二选一 |

### 响应示例

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "refundOrderNo": "RF202608110000000001",
    "orderNo": "YL202608110000000001",
    "refundType": "REFUND_ONLY",
    "refundAmount": "79.00",
    "status": 400,
    "statusName": "退款成功",
    "applyTime": "2026-08-11 15:00:00",
    "approveTime": "2026-08-11 15:02:00",
    "refundTime": "2026-08-11 15:05:00",
    "expectedArrival": "2026-08-13 23:59:59",
    "channel": "WECHAT",
    "channelRefundNo": "5022026081130000000001",
    "progressLogs": [
      { "status": 100, "statusName": "待审核", "time": "2026-08-11 15:00:00", "remark": "申请已提交" },
      { "status": 200, "statusName": "审核通过", "time": "2026-08-11 15:02:00", "remark": "自动审核通过" },
      { "status": 300, "statusName": "退款中", "time": "2026-08-11 15:03:00", "remark": "正在处理退款" },
      { "status": 400, "statusName": "退款成功", "time": "2026-08-11 15:05:00", "remark": "退款已到账" }
    ]
  }
}
```

## 全局错误码

| 错误码 | HTTP 状态码 | 说明 |
|---|---|---|
| 0 | 200 | 成功 |
| 10001 | 401 | 未登录或 Token 已过期 |
| 10002 | 403 | 无权限访问该资源（业务线隔离拦截） |
| 10003 | 400 | 请求参数校验失败 |
| 10004 | 500 | 服务器内部错误 |
| 10101 | 400 | 订单不存在（ORD_NOT_FOUND） |
| 10102 | 400 | 订单状态不允许操作（ORD_STATUS_INVALID） |
| 10103 | 400 | 订单已支付（ORD_ALREADY_PAID） |
| 10104 | 400 | 商品价格已变动（ORD_PRICE_CHANGED） |
| 10105 | 400 | 库存不足（ORD_STOCK_LACK） |
| 10106 | 400 | 风控拦截（ORD_RISK_REJECT） |
| 10201 | 400 | 退款申请被拦截（RF_XXX 系列） |