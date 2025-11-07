import redis from 'redis';
import { promisify } from 'util';

class RedisClient {
  constructor() {
    this.client = redis.createClient();

    // Promisify methods
    this.getAsync = promisify(this.client.get).bind(this.client);
    this.setexAsync = promisify(this.client.setex).bind(this.client);
    this.delAsync = promisify(this.client.del).bind(this.client);

    // Handle errors
    this.client.on('error', (error) => {
      console.error('Redis Client Error:', error);
    });
  }

  isAlive() {
    return this.client.connected;
  }

  async get(key) {
    try {
      const value = await this.getAsync(key);
      return value;
    } catch (error) {
      console.error('Error getting key:', error);
      return null;
    }
  }

  async set(key, value, duration) {
    try {
      await this.setexAsync(key, duration, value.toString());
    } catch (error) {
      console.error('Error setting key:', error);
    }
  }

  async del(key) {
    try {
      await this.delAsync(key);
    } catch (error) {
      console.error('Error deleting key:', error);
    }
  }
}

const redisClient = new RedisClient();
export default redisClient;

