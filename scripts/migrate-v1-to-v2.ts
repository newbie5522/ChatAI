/**
 * V1 到 V2 数据迁移脚本
 * 从 localStorage 会话数据迁移到 Prisma 数据库
 */

import { PrismaClient } from '@prisma/client';
import type { ChatSession } from '../app/store/chat';
import {
  ConversationRepository,
  MessageRepository,
  RunRepository,
} from '../app/repositories';

interface V1Session {
  id: string;
  topic: string;
  messages: Array<{
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    date: string;
    streaming?: boolean;
    isError?: boolean;
    model?: string;
  }>;
  stat: {
    tokenCount: number;
    wordCount: number;
    charCount: number;
  };
  lastUpdate: number;
  lastSummarizeIndex: number;
  mask: {
    id: string;
    avatar: string;
    name: string;
  };
}

export class V1ToV2Migrator {
  private prisma: PrismaClient;
  private convRepo: ConversationRepository;
  private msgRepo: MessageRepository;
  private runRepo: RunRepository;

  constructor() {
    this.prisma = new PrismaClient();
    this.convRepo = new ConversationRepository(this.prisma);
    this.msgRepo = new MessageRepository(this.prisma);
    this.runRepo = new RunRepository(this.prisma);
  }

  /**
   * 从 localStorage 读取 V1 会话数据
   */
  private readV1Sessions(): V1Session[] {
    if (typeof window === 'undefined') {
      throw new Error('Migration must run in browser context');
    }

    const chatStore = localStorage.getItem('chat-next-web-store');
    if (!chatStore) {
      return [];
    }

    try {
      const store = JSON.parse(chatStore);
      return store.state?.sessions || [];
    } catch (e) {
      console.error('Failed to parse V1 sessions:', e);
      return [];
    }
  }

  /**
   * 迁移单个会话
   */
  async migrateSession(
    v1Session: V1Session,
    employeeId: string,
  ): Promise<string> {
    // 创建会话
    const conversation = await this.convRepo.create({
      employeeId,
      topic: v1Session.topic || '未命名会话',
    });

    console.log(`Created conversation: ${conversation.id}`);

    // 迁移消息
    for (const v1Msg of v1Session.messages) {
      const message = await this.msgRepo.create({
        conversationId: conversation.id,
        role: v1Msg.role,
        content: v1Msg.content,
        contentType: 'text',
      });

      console.log(`  Migrated message: ${message.id}`);

      // 如果是助手消息且有模型信息，创建 Run 记录
      if (v1Msg.role === 'assistant' && v1Msg.model) {
        const run = await this.runRepo.create({
          messageId: message.id,
          requestId: `v1-migration-${v1Msg.id}`,
          model: v1Msg.model,
          providerName: 'unknown', // V1 不记录 provider
        });

        // 根据错误状态更新 Run
        if (v1Msg.isError) {
          await this.runRepo.updateStatus(run.id, 'failed', {
            code: 'UNKNOWN_V1_ERROR',
            message: 'Migrated from V1 error state',
          });
        } else {
          await this.runRepo.updateStatus(run.id, 'completed');
        }

        console.log(`    Created run: ${run.id}`);
      }
    }

    return conversation.id;
  }

  /**
   * 执行完整迁移
   */
  async migrate(employeeId: string): Promise<{
    total: number;
    migrated: string[];
    failed: Array<{ sessionId: string; error: string }>;
  }> {
    const v1Sessions = this.readV1Sessions();
    const migrated: string[] = [];
    const failed: Array<{ sessionId: string; error: string }> = [];

    console.log(`Found ${v1Sessions.length} V1 sessions to migrate`);

    for (const session of v1Sessions) {
      try {
        const conversationId = await this.migrateSession(session, employeeId);
        migrated.push(conversationId);
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        console.error(`Failed to migrate session ${session.id}:`, error);
        failed.push({ sessionId: session.id, error });
      }
    }

    console.log(`Migration complete: ${migrated.length} succeeded, ${failed.length} failed`);

    return {
      total: v1Sessions.length,
      migrated,
      failed,
    };
  }

  /**
   * 验证迁移结果
   */
  async verify(employeeId: string): Promise<{
    conversationCount: number;
    messageCount: number;
    runCount: number;
  }> {
    const conversations = await this.convRepo.findByEmployeeId(employeeId);
    
    let messageCount = 0;
    let runCount = 0;

    for (const conv of conversations) {
      const messages = await this.msgRepo.findByConversationId(conv.id);
      messageCount += messages.length;

      for (const msg of messages) {
        const runs = await this.runRepo.findByMessageId(msg.id);
        runCount += runs.length;
      }
    }

    return {
      conversationCount: conversations.length,
      messageCount,
      runCount,
    };
  }

  async disconnect() {
    await this.prisma.$disconnect();
  }
}

// CLI 使用示例
if (require.main === module) {
  const employeeId = process.argv[2];
  
  if (!employeeId) {
    console.error('Usage: tsx migrate-v1-to-v2.ts <employeeId>');
    process.exit(1);
  }

  const migrator = new V1ToV2Migrator();

  migrator
    .migrate(employeeId)
    .then(async (result) => {
      console.log('\nMigration Result:');
      console.log(JSON.stringify(result, null, 2));

      console.log('\nVerifying...');
      const verification = await migrator.verify(employeeId);
      console.log(JSON.stringify(verification, null, 2));

      await migrator.disconnect();
    })
    .catch(async (e) => {
      console.error('Migration failed:', e);
      await migrator.disconnect();
      process.exit(1);
    });
}
