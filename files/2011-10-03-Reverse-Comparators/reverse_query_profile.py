#!/usr/bin/env python

"""Tool for profiling Cassandra query performance using reverse comparators. 

Tests are run by profile() multiple times and the 'Read Latency' is 
extracted using node tool.  

Usage:

#Create the schema using the cassandra-cli. 

create keyspace reverse
    with strategy_options=[{replication_factor:1}]
    and placement_strategy = 'org.apache.cassandra.locator.SimpleStrategy';

use reverse;

create column family NoCache_Ascending
    with comparator = AsciiType
    and default_validation_class = AsciiType
    and key_validation_class = AsciiType
    and keys_cached = 0
    and rows_cached = 0;

create column family NoCache_Descending
    with comparator = 'AsciiType(reversed=true)'
    and default_validation_class = AsciiType
    and key_validation_class = AsciiType
    and keys_cached = 0
    and rows_cached = 0;
    
#Load data
$python reverse_query_profile.py insert_rows

#Warm up the database
$python reverse_query_profile.py warm_up

#Test the name locality for query by column name
$python reverse_query_profile.py name_locality

#Test the start position for query by range
$python reverse_query_profile.py start_position
"""

import itertools
import math
import multiprocessing
import os.path
import re
import shlex
import subprocess
import sys
import time
import traceback

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

CASSANDRA_PATH = "/Users/aaron/frameworks/cassandra/apache-cassandra-0.8.6/bin/"
CF_NAMES = ["NoCache_Ascending", "NoCache_Descending"]

col_pattern = "{0:0>#10}"
profile_pattern = "Row {0:>20} latency in ms "\
    "{1:>10.4} {2:>10.4} {3:>10.4} {4:>10.4}"

def make_cols(cols):
    """Make the column names"""
    return [col_pattern.format(i) for i in xrange(cols)]

# ========================
# Test Harness 

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
    global cfs
    
    nodetool_path = os.path.join(CASSANDRA_PATH, "nodetool")
    cmd = nodetool_path + " -h localhost cfstats"
    
    print "Latency is min, 80th percentile, 95th percentile and max."
    print target.__doc__
    print
    
    last_cf_name = None
    for cf_name, row_def in itertools.product(CF_NAMES, rows):
        key, cols = row_def
        if last_cf_name != cf_name:
            print "Testing CF: %s" % cf_name
            last_cf_name = cf_name
        
        conn = pycassa.connect("reverse", ["localhost"])
        cf = pycassa.columnfamily.ColumnFamily(conn, cf_name)
        latency = []
        low_col_warn = False
        for i in range(repeat):
            run(cmd)
            rv = target(cf, key, cols)
            std_out, std_err = run(cmd)
            if std_err:
                raise RuntimeError(std_err)
            if len(rv) != 100:
                raise RuntimeError("Did not get 100 columns")
            assert int(rv.keys()[0] > int(rv.keys()[-1]))
            this_latency = _parse_latency(cf.column_family, std_out)
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
    
def _parse_latency(cf_name, data):
    """Parse the nodetool std out to get the recent read latency for the CF.
    """
    
    found_cf = False
    for line in data.split("\n"):
        line = line.strip()
        if not found_cf:
            found_cf = line.startswith("Column Family: %s" % cf_name)
            continue
        if found_cf:
            token = re.findall("Read Latency: (?P<foo>\S*)", line)
            if not token:
                continue
            return (float(token[0]))
    return None

def recent_100_start():
    """Get the most recent (highest) 100 columns using start column"""
    
    def test1(cf, key, cols):
        """100 most recent columns, using start"""
        cols_rev = cf.column_family.endswith("Descending")
        start = make_cols(cols)[-1] if cols_rev else make_cols(cols)[-100]
        return cf.get(key, column_start=start, column_count=100)
    profile(test1)

def recent_100_count():
    """Get the most recent (highest) 100 columns using count only"""
    
    def test1(cf, key, cols):
        """100 most recent columns, using no start"""
        cols_rev = not cf.column_family.endswith("Descending")
        return cf.get(key, column_count=100, column_reversed=cols_rev)
        
    profile(test1)
    
    return

# ========================
# Data Setup

def do_warmup(task):
    cf_name, row_key = task
    print "Starting row key %s for CF %s" % (row_key, cf_name)
    conn = pycassa.connect("reverse", ["localhost"])
    cf = pycassa.columnfamily.ColumnFamily(conn, cf_name)

    start_col = ""
    while start_col is not None:
        cols = cf.get(row_key, column_start=start_col, column_count=1000)
        start_col, _ = cols.popitem(last=True) if len(cols) > 1 else (
            None, None)
    print "Finished row key %s for CF %s" % (row_key, cf_name)
    
def safe_do_warmup(task):
    try:
        return do_warmup(task)
    except (BaseException) as e:
        print("Error in processing %s %s" % (task, traceback.format_exc()))
    return
    
def warm_up():
    """Scan through all of the keys in each row to warm the server"""
    
    global rows
    
    tasks = [
        (cf_name, row_def[0]) 
        for cf_name, row_def in itertools.product(CF_NAMES, rows)
    ]
        
    pool = multiprocessing.Pool()
    start = time.time()
    
    try:
        pool.map_async(safe_do_warmup, tasks)
        pool.close()
        pool.join()
    except:
        pool.terminate()
        raise
    print "Finish in ", time.time() - start
    return
    

def do_insert(task):
    cf_name, row_key, col_count = task
    print "Starting row key %s for CF %s" % (row_key, cf_name)
    #automatic send every 100 cols
    conn = pycassa.connect("reverse", ["localhost"])
    cf = pycassa.columnfamily.ColumnFamily(conn, cf_name)

    mutator = pycassa.batch.Mutator(conn, queue_size=100)
    data = ("foo" * 10)[:25]
    for col_name in make_cols(col_count):
        mutator.insert(cf, row_key, 
            {col_name : data})
    mutator.send()
    print "Finished row key %s for CF %s" % (row_key, cf_name)
    return

def safe_do_insert(task):
    try:
        return do_insert(task)
    except (BaseException) as e:
        print("Error in processing %s %s" % (task, traceback.format_exc()))
    return
              
def insert_rows():
    """Insert rows into the DB for testing"""
    global rows
    
    tasks = [
        (cf_name, row_def[0], row_def[1]) 
        for cf_name, row_def in itertools.product(CF_NAMES, rows)
    ]
        
    pool = multiprocessing.Pool()
    start = time.time()
    
    try:
        pool.map_async(safe_do_insert, tasks)
        pool.close()
        pool.join()
    except:
        pool.terminate()
        raise
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
    
        