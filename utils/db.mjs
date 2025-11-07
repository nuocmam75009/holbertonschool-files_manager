import { MongoClient } from 'mongodb';

class DBClient {
  constructor() {
    const host = process.env.DB_HOST || 'localhost';
    const port = process.env.DB_PORT || 27017;
    const database = process.env.DB_DATABASE || 'files_manager';

    const uri = `mongodb://${host}:${port}`;
    this.client = new MongoClient(uri, { useUnifiedTopology: true });
    this.database = database;
    this.db = null;

    // Connect to MongoDB
    this.client.connect()
      .then(() => {
        this.db = this.client.db(this.database);
      })
      .catch((error) => {
        console.error('MongoDB connection error:', error);
      });
  }

  isAlive() {
    return this.client.topology && this.client.topology.isConnected();
  }

  async nbUsers() {
    try {
      if (!this.db) {
        this.db = this.client.db(this.database);
      }
      const count = await this.db.collection('users').countDocuments();
      return count;
    } catch (error) {
      console.error('Error counting users:', error);
      return 0;
    }
  }

  async nbFiles() {
    try {
      if (!this.db) {
        this.db = this.client.db(this.database);
      }
      const count = await this.db.collection('files').countDocuments();
      return count;
    } catch (error) {
      console.error('Error counting files:', error);
      return 0;
    }
  }

  async getDb() {
    if (!this.db) {
      this.db = this.client.db(this.database);
    }
    return this.db;
  }
}

const dbClient = new DBClient();
export default dbClient;

