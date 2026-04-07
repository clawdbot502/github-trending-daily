/**
 * Feishu (Lark) API SDK
 * 封装飞书开放平台常用 API
 */

import axios, { AxiosInstance } from 'axios';

// 飞书 API 响应结构
interface FeishuResponse<T = unknown> {
  code: number;
  msg: string;
  data?: T;
}

// 飞书 Token 响应
interface TokenResponse {
  tenant_access_token: string;
  expire: number;
}

// 记录数据结构
interface BaseRecord {
  fields: Record<string, unknown>;
}

interface BaseRecordsResponse {
  records: Array<{
    record_id: string;
    fields: Record<string, unknown>;
  }>;
  has_more: boolean;
  total?: number;
}

export class FeishuSDK {
  private appId: string;
  private appSecret: string;
  private token: string | null = null;
  private tokenExpireTime: number = 0;
  private http: AxiosInstance;

  constructor(appId: string, appSecret: string) {
    this.appId = appId;
    this.appSecret = appSecret;
    this.http = axios.create({
      baseURL: 'https://open.feishu.cn/open-apis',
      timeout: 30000,
    });
  }

  /**
   * 获取 tenant_access_token
   */
  async getToken(): Promise<string> {
    // Token 还有 5 分钟才过期时，直接返回缓存的 token
    if (this.token && Date.now() < this.tokenExpireTime - 5 * 60 * 1000) {
      return this.token;
    }

    console.log('Getting Feishu token...');
    const response = await this.http.post<FeishuResponse<TokenResponse>>(
      '/auth/v3/tenant_access_token/internal',
      {
        app_id: this.appId,
        app_secret: this.appSecret,
      }
    );

    console.log('Token response:', JSON.stringify(response.data, null, 2));

    if (response.data.code !== 0) {
      throw new Error(`Failed to get token: ${response.data.msg} (code: ${response.data.code})`);
    }

    if (!response.data.data) {
      throw new Error('Token response data is undefined');
    }

    this.token = response.data.data.tenant_access_token;
    this.tokenExpireTime = Date.now() + response.data.data.expire * 1000;
    console.log('Token obtained successfully');
    return this.token;
  }

  /**
   * 批量创建记录（追加模式）
   */
  async batchCreateRecords(
    baseToken: string,
    tableId: string,
    records: BaseRecord[]
  ): Promise<string[]> {
    const token = await this.getToken();

    // 飞书批量创建限制 500 条/次
    const batchSize = 500;
    const recordIds: string[] = [];

    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);

      const response = await this.http.post<FeishuResponse<BaseRecordsResponse>>(
        `/bitable/v1/apps/${baseToken}/tables/${tableId}/records/batch_create`,
        { records: batch },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (response.data.code !== 0) {
        throw new Error(`Failed to create records: ${response.data.msg}`);
      }

      recordIds.push(...response.data.data!.records.map((r) => r.record_id));

      // 批次间延迟 500ms，避免限流
      if (i + batchSize < records.length) {
        await sleep(500);
      }
    }

    return recordIds;
  }

  /**
   * 发送消息到群聊
   */
  async sendMessage(
    chatId: string,
    content: string,
    msgType: 'text' | 'post' = 'post'
  ): Promise<string> {
    const token = await this.getToken();

    const payload: Record<string, unknown> = {
      receive_id: chatId,
      msg_type: msgType,
    };

    if (msgType === 'text') {
      payload.content = JSON.stringify({ text: content });
    } else {
      // post 类型
      payload.content = JSON.stringify({
        zh_cn: {
          title: 'GitHub Trending Daily',
          content: [
            [
              {
                tag: 'md',
                text: content,
              },
            ],
          ],
        },
      });
    }

    const response = await this.http.post<FeishuResponse<{ message_id: string }>>(
      '/im/v1/messages',
      payload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        params: {
          receive_id_type: 'chat_id',
        },
      }
    );

    if (response.data.code !== 0) {
      throw new Error(`Failed to send message: ${response.data.msg}`);
    }

    return response.data.data!.message_id;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
