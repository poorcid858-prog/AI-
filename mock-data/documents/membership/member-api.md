---
title: 会员接口文档
docId: MBR-API-004
bizLine: membership
securityLevel: internal
owner: 会员产品组 / 李四
version: v3.0
updatedAt: 2026-07-14
tags: [API, 会员, 积分, 优惠券, 接口]
---

# 会员接口文档

> 基础路径：`/api/v1/member`。需登录态，请求头携带 `Authorization: Bearer <token>`。
> 返回格式：`{ "code": 0, "message": "success", "data": { ... } }`。

---

## 接口 1：查询会员信息

查询当前登录会员的等级、成长值、权益快照。

### 请求

| 项 | 值 |
|---|---|
| HTTP 方法 | GET |
| 路径 | `/api/v1/member/info` |

### 请求参数

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| memberId | string | 否 | 会员 ID，不传则取登录态会员；仅运营端可传他人 ID |
| withBenefits | boolean | 否 | 是否返回完整权益清单，默认 true |

### 响应示例

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "memberId": "m_10000123",
    "nickname": "云集小李",
    "level": "L3",
    "levelName": "金卡会员",
    "totalGrowth": 8600,
    "periodGrowth": 6200,
    "nextLevel": "L4",
    "nextLevelName": "钻石会员",
    "growthToNextLevel": 13800,
    "levelStartTime": "2026-03-01 00:00:00",
    "levelExpireTime": "2027-03-01 00:00:00",
    "keepLevelGrowth": 4000,
    "keepLevelStatus": "ACHIEVED",
    "benefits": {
      "discountRate": "0.95",
      "freeFreightThreshold": "39.00",
      "growthRate": "1.5",
      "pointRate": "1.5",
      "exclusiveService": true,
      "afterSaleDays": 15,
      "freeReturnQuota": 4,
      "newProductAheadHours": 6,
      "monthlyCouponPackage": "6 张（合计 80 元）"
    }
  }
}
```

### 错误码

| 错误码 | 说明 |
|---|---|
| MB_NOT_FOUND | 会员不存在 |
| MB_FROZEN | 会员账户已冻结（违规处理中） |
| MB_NO_PERMISSION | 无权查询他人会员信息 |

---

## 接口 2：查询积分余额

### 请求

| 项 | 值 |
|---|---|
| HTTP 方法 | GET |
| 路径 | `/api/v1/member/point/balance` |

### 请求参数

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| memberId | string | 否 | 会员 ID，不传取登录态 |
| withExpiring | boolean | 否 | 是否返回即将过期积分，默认 true |

### 响应示例

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "memberId": "m_10000123",
    "totalPoint": 15800,
    "availablePoint": 14300,
    "frozenPoint": 1500,
    "accumulatedPoint": 68200,
    "usedPoint": 52400,
    "expiredPoint": 0,
    "equivalentAmount": "143.00",
    "expiringSoon": [
      { "point": 2000, "expireTime": "2026-09-30 23:59:59" },
      { "point": 800, "expireTime": "2026-12-31 23:59:59" }
    ],
    "status": 1
  }
}
```

---

## 接口 3：积分流水查询

### 请求

| 项 | 值 |
|---|---|
| HTTP 方法 | GET |
| 路径 | `/api/v1/member/point/logs` |

### 请求参数

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| changeType | string | 否 | 变更类型筛选：GET/USE/FREEZE/UNFREEZE/REFUND_BACK/DEDUCT/EXPIRE |
| sourceType | string | 否 | 来源筛选：CONSUME/SIGN_IN/REVIEW/SHARE/INVITE/ACTIVITY/LEVEL_UP |
| startTime | string | 否 | 开始时间，格式 yyyy-MM-dd，最早支持查 12 个月内 |
| endTime | string | 否 | 结束时间 |
| page | int | 否 | 页码，默认 1 |
| pageSize | int | 否 | 每页条数，默认 20，最大 50 |

### 响应示例

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "total": 246,
    "page": 1,
    "pageSize": 20,
    "list": [
      {
        "logId": "pl_900001",
        "changeType": "GET",
        "changeAmount": 1125,
        "balanceAfter": 15800,
        "sourceType": "CONSUME",
        "bizNo": "YL202608010000000088",
        "remark": "订单完成赠送积分（金卡 1.5 倍）",
        "createTime": "2026-08-02 03:12:00"
      },
      {
        "logId": "pl_899998",
        "changeType": "FREEZE",
        "changeAmount": -1500,
        "balanceAfter": 14675,
        "sourceType": "CONSUME",
        "bizNo": "YL202608100000000101",
        "remark": "下单使用积分抵扣，冻结中",
        "createTime": "2026-08-10 20:44:00"
      }
    ]
  }
}
```

### 错误码

| 错误码 | 说明 |
|---|---|
| PT_TIME_RANGE_INVALID | 查询时间跨度超过 12 个月 |
| PT_PARAM_INVALID | 参数校验失败 |

---

## 接口 4：积分抵扣（试算与冻结）

用于结算页积分抵扣试算与下单时积分冻结。

### 请求

| 项 | 值 |
|---|---|
| HTTP 方法 | POST |
| 路径 | `/api/v1/member/point/deduct` |

### 请求参数

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| mode | string | 是 | 模式：`TRIAL` 仅试算（不冻结）/ `FREEZE` 冻结积分 |
| bizNo | string | FREEZE 时必填 | 业务单号（订单号），作为冻结幂等键 |
| goodsAmount | string | 是 | 可抵扣商品金额，用于计算 30% 抵扣上限 |
| deductPoint | int | 否 | 期望抵扣积分数，必须为 100 的整数倍；不传则返回最大可抵扣 |

### 响应示例

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "maxDeductPoint": 20000,
    "maxDeductAmount": "200.00",
    "actualDeductPoint": 14300,
    "actualDeductAmount": "143.00",
    "availablePointAfter": 0,
    "frozen": true,
    "bizNo": "YL202608110000000001",
    "rule": "100 积分抵 1 元，单笔最高抵扣商品金额 30%，上限 20000 积分"
  }
}
```

### 错误码

| 错误码 | 说明 |
|---|---|
| PT_INSUFFICIENT | 可用积分不足 |
| PT_BELOW_MIN | 低于最低使用门槛（500 积分） |
| PT_NOT_MULTIPLE | 抵扣积分不是 100 的整数倍 |
| PT_EXCEED_LIMIT | 超过单笔抵扣上限（商品金额 30% 或 20000 积分） |
| PT_ACCOUNT_FROZEN | 积分账户已冻结，暂不可使用 |
| PT_GOODS_NOT_SUPPORT | 该商品不支持积分抵扣 |

---

## 接口 5：查询可用优惠券

返回会员券包，并给出当前购物车的选优建议。

### 请求

| 项 | 值 |
|---|---|
| HTTP 方法 | POST |
| 路径 | `/api/v1/member/coupon/available` |

### 请求参数

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| status | int | 否 | 券状态筛选：1 未使用 / 3 已使用 / 4 已过期，默认 1 |
| items | array | 否 | 购物车商品列表（`skuId`、`categoryId`、`brandId`、`amount`），传了则返回选优结果 |
| freightAmount | string | 否 | 运费金额，用于运费券试算 |
| page | int | 否 | 页码，默认 1 |
| pageSize | int | 否 | 每页条数，默认 20 |

### 响应示例

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "total": 12,
    "usableCount": 5,
    "bestCombo": {
      "couponIds": ["c_70001", "c_70003"],
      "totalDiscount": "70.00",
      "freightCouponId": "c_70008",
      "freightDiscount": "12.00",
      "tip": "已为您选择最优组合，共省 82 元"
    },
    "list": [
      {
        "couponId": "c_70001",
        "couponCode": "YLQ****A8K2",
        "templateName": "金卡会员专享满 200 减 40",
        "couponType": "FULL_CUT",
        "thresholdAmount": "200.00",
        "discountAmount": "40.00",
        "scopeType": "ALL",
        "scopeDesc": "全站通用",
        "stackableGroup": "PLATFORM",
        "usable": true,
        "validEndTime": "2026-08-31 23:59:59",
        "estimatedDiscount": "40.00"
      },
      {
        "couponId": "c_70003",
        "couponCode": "YLQ****M3P9",
        "templateName": "服饰类满 300 减 30",
        "couponType": "CATEGORY",
        "thresholdAmount": "300.00",
        "discountAmount": "30.00",
        "scopeType": "CATEGORY",
        "scopeDesc": "限服饰类目",
        "stackableGroup": "CATEGORY",
        "usable": true,
        "validEndTime": "2026-08-20 23:59:59",
        "estimatedDiscount": "30.00"
      },
      {
        "couponId": "c_70005",
        "couponCode": "YLQ****T7R1",
        "templateName": "新人无门槛 5 元券",
        "couponType": "NO_THRESHOLD",
        "thresholdAmount": "0.00",
        "discountAmount": "5.00",
        "scopeType": "ALL",
        "scopeDesc": "全站通用",
        "stackableGroup": "PLATFORM",
        "usable": false,
        "unusableReason": "与已选平台券互斥（同组只能用 1 张）",
        "validEndTime": "2026-08-15 23:59:59",
        "estimatedDiscount": "0.00"
      }
    ]
  }
}
```

---

## 接口 6：领取优惠券

### 请求

| 项 | 值 |
|---|---|
| HTTP 方法 | POST |
| 路径 | `/api/v1/member/coupon/receive` |

### 请求参数

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| templateId | string | 是 | 券模板 ID |
| getChannel | string | 否 | 领取渠道：SELF_GET/ACTIVITY，默认 SELF_GET |
| activityId | string | 否 | 活动 ID，`getChannel=ACTIVITY` 时必填 |
| requestId | string | 是 | 幂等令牌，UUID 格式，防重复领取 |

### 响应示例

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "couponId": "c_70012",
    "couponCode": "YLQ8H2KM3P9A",
    "templateName": "钻石会员专享满 500 减 100",
    "couponType": "FULL_CUT",
    "thresholdAmount": "500.00",
    "discountAmount": "100.00",
    "validStartTime": "2026-08-11 00:00:00",
    "validEndTime": "2026-09-10 23:59:59",
    "remainStock": 87,
    "receivedCount": 1,
    "perMemberLimit": 1
  }
}
```

### 错误码

| 错误码 | 说明 |
|---|---|
| CP_STOCK_EMPTY | 券已被领完 |
| CP_LIMIT_EXCEEDED | 已达每人限领张数 |
| CP_LEVEL_NOT_MATCH | 会员等级不满足领取条件 |
| CP_NOT_START | 领券活动未开始 |
| CP_ENDED | 领券活动已结束 |
| CP_TEMPLATE_OFFLINE | 券模板已下线 |
| CP_DUPLICATE_REQUEST | 重复请求，已领取成功 |
| CP_ACTIVITY_INVALID | 活动不存在或不可参与 |

## 全局错误码

| 错误码 | HTTP 状态码 | 说明 |
|---|---|---|
| 0 | 200 | 成功 |
| 10001 | 401 | 未登录或 Token 已过期 |
| 10002 | 403 | 无权限访问该资源（业务线隔离拦截） |
| 10003 | 400 | 请求参数校验失败 |
| 10004 | 500 | 服务器内部错误 |
| 20101 | 400 | 会员不存在（MB_NOT_FOUND） |
| 20102 | 403 | 会员账户已冻结（MB_FROZEN） |
| 20201 | 400 | 积分相关错误（PT_XXX 系列） |
| 20301 | 400 | 优惠券相关错误（CP_XXX 系列） |