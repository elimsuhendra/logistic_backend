import { PubSub } from 'graphql-subscriptions';
import { RedisPubSub } from 'graphql-redis-subscriptions';

const pubsub = process.env.REDIS_HOST
  ? new RedisPubSub({
      connection: {
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT, 10) : 6379,
        retry_strategy: options => Math.max(options.attempt * 100, 3000),
      },
      connectionListener: err => {
        if (err) {
          console.error('Redis connection error:', err.message || err);
        }
      },
    })
  : new PubSub();

export default pubsub;
