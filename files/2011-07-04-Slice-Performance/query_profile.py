"""Tool for profiling Cassandra query performance. 

Tests are run by profile() multiple times and the 'Read Latency' is 
extracted using node tool.  

Usage:

#Create the schema using the cassandra-cli. 

create keyspace query
    with strategy_options=[{replication_factor:1}]
    and placement_strategy = 'org.apache.cassandra.locator.SimpleStrategy';

use query;

create column family NoCache
    with comparator = AsciiType
    and default_validation_class = AsciiType
    and key_validation_class = AsciiType
    and keys_cached = 0
    and rows_cached = 0;


#Load data
$python query_profile.py insert_rows

#Warm up the database
$python query_profile.py warm_up

#Test the name locality for query by column name
$python query_profile.py name_locality

#Test the start position for query by range
$python query_profile.py start_position
"""

import math
import multiprocessing
import operator
import os
import os.path
import random
import re
import shlex
import subprocess
import sys
import time

import pycassa

rows = [
    ("small-row", 100), # 100 columns, 5K of data
    ("no-col-index", 1200), # 1200 columns, 60K of data
    ("five-thousand", 5000), # 5000 columns, 244K of data
    ("ten-thousand", 10000), # 10000 columns, 488K of data
    ("hundred-thousand", 100000), # 100000 columns, 4.8M of data
    ("one-million", 1000000), # 1000000 columns, 48M of data
    ("ten-million", 10000000) # 10000000 columns, 480M of data
]

CASSANDRA_PATH = "/Users/aaron/frameworks/cassandra/apache-cassandra-0.8.1/bin/"
CASS_POOL = pycassa.connect("query", ["localhost"])
NOCACHE = pycassa.columnfamily.ColumnFamily(CASS_POOL, "NoCache")

col_pattern = "{0:0>#10}"
profile_pattern = "Row {0:>20} latency in ms "\
    "{1:>10.4} {2:>10.4} {3:>10.4} {4:>10.4}"

def make_cols(cols):
    """Make the column names"""
    return [col_pattern.format(i) for i in xrange(cols)]

def make_paged_cols(cols, shuffle=True):
    """Split the cols into pages about the size as a column index page
    1310 * 50B = 63.9K
    
    :param shuffle: Shuffle the pages
    
    :returns: List of lists.
    """
    
    all_cols = make_cols(cols)
    pages_start = range(0, cols, 1310)
    pages_end = pages_start[1:] + [cols]
    
    pages = [
        operator.getslice(all_cols, start, end) 
        for start, end in zip(pages_start, pages_end)
    ]
    if shuffle:
        random.shuffle(pages)
    return pages
    
def col_range(start, cols, count):
    """A range of columns from the start or end of the column list.
    
    :returns: list of column names.
    """
    all_cols = make_cols(cols)
    return all_cols[:count] if start else all_cols[-count:]

def range_paged_cols(start, cols, range, shuffle_pages=False, 
    shuffle_columns=False, collapse=True):
    """select a range from the start or end of each page of columns
    
    :returns: list of columns if collapse, else list of list of columns.
    """
    
    result = []
    for page in make_paged_cols(cols, shuffle=shuffle_pages):
        if shuffle_columns:
            random.shuffle(page)
        if collapse:
            result.extend(page[:range] if start else page[-range:])
        else:
            result.append(page[:range] if start else page[-range:])
    return result

def start_col(cols, offset, page_offset=None):
    """A single column name at the offset from the start of the row.
    
    :returns: str column name
    """
    
    if page_offset is None:
        all_cols = make_cols(cols)
    else:
        all_cols = make_paged_cols(cols, shuffle=False)
        all_cols = all_cols[min(page_offset, len(all_cols)-1)]
    return all_cols[offset]

# ========================
# Testing functions 

def run(cmd):
    """Execute the command line"""
    p = subprocess.Popen(shlex.split(cmd), stdout=subprocess.PIPE, 
        stderr=subprocess.PIPE)
    return p.communicate()
    
def percentile(N, percent, key=lambda x:x):
    """
    from http://code.activestate.com/recipes/511478/ (r1)
    Find the percentile of a list of values.

    @parameter N - is a list of values. Note N MUST BE already sorted.
    @parameter percent - a float value from 0.0 to 1.0.
    @parameter key - optional key function to compute value from each element of N.

    @return - the percentile of the values
    """
    if not N:
        return None
    k = (len(N)-1) * percent
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return key(N[int(k)])
    d0 = key(N[int(f)]) * (k-f)
    d1 = key(N[int(c)]) * (c-k)
    return d0+d1
    
    
def profile(target, repeat=10):
    """Clears the recent latency stats, runs the target and then gets the 
    latency stats again.
    """
    global rows
    
    nodetool_path = os.path.join(CASSANDRA_PATH, "nodetool")
    cmd = nodetool_path + " -h localhost cfstats"
    
    print "Latency is min, 80th percentile, 95th percentile and max."
    print target.__doc__
    print
    
    for key, cols in rows:
        latency = []
        low_col_warn = False
        for i in range(repeat):
            run(cmd)
            rv = target(key, cols)
            std_out, std_err = run(cmd)
            if std_err:
                raise RuntimeError(std_err)
            if len(rv) < 100 and not low_col_warn:
                print "WARN: only %s columns returned" % len(rv)
                low_col_warn = True
                
            this_latency = _parse_latency(std_out)
            if this_latency is not None:
                latency.append(this_latency)
        
        latency.sort()
        stats = (
            min(latency), 
            percentile(latency, 0.8), 
            percentile(latency, 0.95), 
            max(latency)
        )
        print profile_pattern.format(key, *stats)
    print 
    return
    
def _parse_latency(data):
    """Parse the nodetool std out to get the recent read latency for the CF.
    """
    
    found_cf = False
    for line in data.split("\n"):
        line = line.strip()
        if not found_cf:
            found_cf = line.startswith("Column Family: NoCache")
            continue
        if found_cf:
            token = re.findall("Read Latency: (?P<foo>\S*)", line)
            if not token:
                continue
            return (float(token[0]))
    return None

def start_position():
    """Test different start column offsets."""
    
    print "Test start position..."
    print 
    
    def test1(key, cols):
        """100 columns from with no start column"""
        return NOCACHE.get(key, column_count=100)
    profile(test1)

    def test2(key, cols):
        """100 columns from the start of the row with a start col"""
        x = start_col(cols, 0)
        return NOCACHE.get(key, column_start=x, column_count=100)
    profile(test2)
    
    def test3(key, cols):
        """100 columns from the start of the second page"""
        x = start_col(cols, 0, page_offset=1)
        return NOCACHE.get(key, column_start=x, column_count=100)
    profile(test3)

    def test4(key, cols):
        """100 columns starting half way through the row"""
        x = start_col(cols, (cols / 2))
        return NOCACHE.get(key, column_start=x, column_count=100)
    profile(test4)
    
    def test5(key, cols):
        """100 columns starting from the last page """
        x = start_col(cols, 0, page_offset=-1)
        return NOCACHE.get(key, column_start=x, column_count=100)
    profile(test5)
    

def name_locality():
    """Test difference between tightly clustered columns and spread out 
    columns."""
    
    print "Test name locality..."
    print 
    
    def test1(key, cols):
        """100 columns by name, start of the row."""
        x = col_range(True, cols, 100)
        return NOCACHE.get(key, columns=x)
    profile(test1)

    def test2(key, cols):
        """100 columns by name, end of the row."""
        x = col_range(False, cols, 100)
        return NOCACHE.get(key, columns=x)
    profile(test2)
    
    def test3(key, cols):
        """100 columns by name, middle of row."""
        x = range_paged_cols(True, cols, 100, collapse=False)
        #Got a list of lists, inner list is columns from a page. 
        #Pick the middle page 
        x = x[int(len(x)/2.0)]
        return NOCACHE.get(key, columns=x)
    profile(test3)
    
    def test4(key, cols):
        """100 columns by name, first 2 cols from 50 random pages"""
        x = range_paged_cols(True, cols, 2, shuffle_pages=True)
        return NOCACHE.get(key, columns=x[:100])
    profile(test4)
    
    def test5(key, cols):
        """100 columns by name, last 2 cols from 50 random pages"""
        x = range_paged_cols(False, cols, 2,shuffle_pages=True)
        return NOCACHE.get(key, columns=x[:100])
    profile(test5)
    
    def test6(key, cols):
        """100 columns by name, random 2 cols from 50 random pages"""
        x = range_paged_cols(False, cols, 2,shuffle_pages=True, 
            shuffle_columns=True)
        return NOCACHE.get(key, columns=x[:100])
    profile(test6)
    
    def test7(key, cols):
        """100 columns by name, first col from 100 random pages"""
        x = range_paged_cols(True, cols, 1,shuffle_pages=True)
        return NOCACHE.get(key, columns=x[:100])
    profile(test7)

    def test8(key, cols):
        """100 columns by name, last col from 100 random pages"""
        x = range_paged_cols(False, cols, 1,shuffle_pages=True, )
        return NOCACHE.get(key, columns=x[:100])
    profile(test8)

    def test9(key, cols):
        """100 columns by name, random col from 100 random pages"""
        x = range_paged_cols(False, cols, 1,shuffle_pages=True, 
            shuffle_columns=True)
        return NOCACHE.get(key, columns=x[:100])
    profile(test9)
    
def warm_up():
    """Scan through all of the keys in each row to warm the server"""
    
    global rows
    
    class Walk(multiprocessing.Process):
        
        def __init__(self, row_key):
            super(Walk, self).__init__()
            self.row_key = row_key
            conn = pycassa.connect("query", ["localhost"])
            self.cf = pycassa.columnfamily.ColumnFamily(conn, "NoCache")
            
        def run(self):
            start_col = ""
            while start_col is not None:
                cols = self.cf.get(self.row_key, column_start=start_col, 
                    column_count=1000)
                start_col, _ = cols.popitem(last=True) if len(cols) > 1 else (
                    None, None)
    
    threads = [Walk(key) for key, cols in rows]
    print "Starting %s processes..." % len(rows)
    start = time.time()
    map(Walk.start, threads)
    
    alive = lambda: (t for t in threads if t.is_alive())
    while (any(alive())):
        time.sleep(1)
        if int(time.time() - start) % 5 == 0:
            print "Alive count ", len(list(alive()))
    print "Finish in ", time.time() - start
    return

def insert_rows():
    """Insert rows into the DB for testing"""
    global rows
    
    class Insert(multiprocessing.Process):
        
        def __init__(self, row_key, cols):
            super(Insert, self).__init__()
            self.row_key = row_key
            self.cols = cols
            self.conn = pycassa.connect("query", ["localhost"])
            self.cf = pycassa.columnfamily.ColumnFamily(self.conn, "NoCache")
            
        def run(self):
            #automatic send every 100 cols
            mutator = pycassa.batch.Mutator(self.conn, queue_size=100)
            data = ("foo" * 10)[:25]
            for i in xrange(self.cols):
                mutator.insert(NOCACHE, self.row_key, 
                    {col_pattern.format(i) : data})
            mutator.send()
            return
                    
    threads = [Insert(key, cols) for key, cols in rows]
    print "Starting %s processes..." % len(rows)
    start = time.time()
    map(Insert.start, threads)
    
    alive = lambda: (t for t in threads if t.is_alive())
    while (any(alive())):
        time.sleep(1)
        if int(time.time() - start) % 5 == 0:
            print "Alive count ", len(list(alive()))
    print "Finish in ", time.time() - start
    return
    
        
if __name__ == "__main__":
    action = sys.argv[1] if len(sys.argv) > 1 else None
    args = [
        token 
        for token in sys.argv[2:] 
        if token.find("=") < 0
    ]
    kwargs = dict(
        token.split("=") 
        for token in sys.argv[2:] 
        if token.find("=") > 0
    )
    
    func = globals().get(action)
    if func:
        func(*args, **kwargs)
    
        