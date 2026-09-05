import psycopg2
from psycopg2.extras import RealDictCursor
import os
from dotenv import load_dotenv

load_dotenv()

def get_db_connection():
    """Get database connection"""
    try:
        conn = psycopg2.connect(os.getenv('DATABASE_URL'))
        return conn
    except Exception as e:
        print(f"❌ Database connection error: {e}")
        return None

def init_db():
    """Initialize database tables"""
    try:
        conn = get_db_connection()
        if not conn:
            return False
        
        cur = conn.cursor()

        # Supabase SaaS projects are provisioned through the reviewed SQL setup.
        # Never try to overlay the incompatible integer-ID prototype schema.
        cur.execute("SELECT to_regclass('public.organizations')")
        if cur.fetchone()[0]:
            conn.close()
            print("✓ Supabase SaaS schema detected")
            return True
        
        # Create transactions table
        cur.execute('''
            CREATE TABLE IF NOT EXISTS transactions (
                id SERIAL PRIMARY KEY,
                source VARCHAR(50) NOT NULL,
                amount DECIMAL(15,2) NOT NULL,
                description TEXT NOT NULL,
                posting_date DATE NOT NULL,
                reference VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # Create matches table
        cur.execute('''
            CREATE TABLE IF NOT EXISTS matches (
                id SERIAL PRIMARY KEY,
                bank_tx_id INTEGER REFERENCES transactions(id),
                erp_tx_id INTEGER REFERENCES transactions(id),
                confidence DECIMAL(5,2),
                status VARCHAR(50) DEFAULT 'suggested',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                confirmed_at TIMESTAMP
            )
        ''')
        
        # Create reconciliation sessions
        cur.execute('''
            CREATE TABLE IF NOT EXISTS reconciliation_sessions (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255),
                bank_count INTEGER,
                erp_count INTEGER,
                matched_count INTEGER,
                match_rate DECIMAL(5,2),
                average_confidence DECIMAL(5,2),
                status VARCHAR(50) DEFAULT 'completed',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        conn.commit()
        conn.close()
        print("✓ Database initialized")
        return True
    
    except Exception as e:
        print(f"❌ Database init error: {e}")
        return False

def save_transaction(source, amount, description, posting_date, reference=None):
    """Save a single transaction"""
    try:
        conn = get_db_connection()
        if not conn:
            return None
        
        cur = conn.cursor()
        cur.execute('''
            INSERT INTO transactions (source, amount, description, posting_date, reference)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id
        ''', (source, amount, description, posting_date, reference))
        
        tx_id = cur.fetchone()[0]
        conn.commit()
        conn.close()
        return tx_id
    
    except Exception as e:
        print(f"❌ Error saving transaction: {e}")
        return None

def save_match(bank_tx_id, erp_tx_id, confidence):
    """Save a match result"""
    try:
        conn = get_db_connection()
        if not conn:
            return None
        
        cur = conn.cursor()
        cur.execute('''
            INSERT INTO matches (bank_tx_id, erp_tx_id, confidence, status)
            VALUES (%s, %s, %s, 'suggested')
            RETURNING id
        ''', (bank_tx_id, erp_tx_id, confidence))
        
        match_id = cur.fetchone()[0]
        conn.commit()
        conn.close()
        return match_id
    
    except Exception as e:
        print(f"❌ Error saving match: {e}")
        return None

def confirm_match(match_id):
    """Confirm a match"""
    try:
        conn = get_db_connection()
        if not conn:
            return False
        
        cur = conn.cursor()
        cur.execute('''
            UPDATE matches 
            SET status = 'confirmed', confirmed_at = CURRENT_TIMESTAMP
            WHERE id = %s
        ''', (match_id,))
        
        conn.commit()
        conn.close()
        return True
    
    except Exception as e:
        print(f"❌ Error confirming match: {e}")
        return False

def reject_match(match_id):
    """Reject a match"""
    try:
        conn = get_db_connection()
        if not conn:
            return False
        
        cur = conn.cursor()
        cur.execute('''
            UPDATE matches 
            SET status = 'rejected'
            WHERE id = %s
        ''', (match_id,))
        
        conn.commit()
        conn.close()
        return True
    
    except Exception as e:
        print(f"❌ Error rejecting match: {e}")
        return False

def get_all_matches(limit=100):
    """Get all matches"""
    try:
        conn = get_db_connection()
        if not conn:
            return []
        
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute('''
            SELECT m.id, m.bank_tx_id, m.erp_tx_id, m.confidence, m.status,
                   b.amount as bank_amount, b.description as bank_desc,
                   e.amount as erp_amount, e.description as erp_desc
            FROM matches m
            JOIN transactions b ON m.bank_tx_id = b.id
            JOIN transactions e ON m.erp_tx_id = e.id
            ORDER BY m.created_at DESC
            LIMIT %s
        ''', (limit,))
        
        matches = cur.fetchall()
        conn.close()
        return matches
    
    except Exception as e:
        print(f"❌ Error getting matches: {e}")
        return []

def get_match_stats():
    """Get reconciliation statistics"""
    try:
        conn = get_db_connection()
        if not conn:
            return {}
        
        cur = conn.cursor(cursor_factory=RealDictCursor)
        
        # Total transactions
        cur.execute('SELECT COUNT(*) as count FROM transactions')
        total_txs = cur.fetchone()['count']
        
        # Total matches
        cur.execute('SELECT COUNT(*) as count FROM matches')
        total_matches = cur.fetchone()['count']
        
        # Confirmed matches
        cur.execute("SELECT COUNT(*) as count FROM matches WHERE status = 'confirmed'")
        confirmed = cur.fetchone()['count']
        
        # Rejected matches
        cur.execute("SELECT COUNT(*) as count FROM matches WHERE status = 'rejected'")
        rejected = cur.fetchone()['count']
        
        # Average confidence
        cur.execute('SELECT AVG(confidence) as avg_confidence FROM matches')
        avg_confidence = cur.fetchone()['avg_confidence']
        
        conn.close()
        
        return {
            'total_transactions': total_txs,
            'total_matches': total_matches,
            'confirmed_matches': confirmed,
            'rejected_matches': rejected,
            'average_confidence': round(avg_confidence, 1) if avg_confidence else 0
        }
    
    except Exception as e:
        print(f"❌ Error getting stats: {e}")
        return {}

def save_reconciliation_session(session_name, total_bank, total_erp, matched, match_rate, avg_confidence, user_id):
    """Save reconciliation session to database"""
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        cur.execute('''
    INSERT INTO reconciliation_sessions 
    (name, matched_count, erp_count, match_rate, average_confidence)
    VALUES (%s, %s, %s, %s, %s)
    RETURNING id
''', (session_name, matched, total_erp - matched, match_rate, avg_confidence))
        
        session_id = cur.fetchone()[0]
        conn.commit()
        conn.close()
        
        return session_id
    except Exception as e:
        print(f"Error saving session: {e}")
        return None

def get_all_sessions():
    """Get all reconciliation sessions"""
    try:
        conn = get_db_connection()
        if not conn:
            return []
        
        cur = conn.cursor(cursor_factory=RealDictCursor)
        cur.execute('''
            SELECT * FROM reconciliation_sessions
            ORDER BY created_at DESC
            LIMIT 50
        ''')
        
        sessions = cur.fetchall()
        conn.close()
        return sessions
    
    except Exception as e:
        print(f"❌ Error getting sessions: {e}")
        return []
