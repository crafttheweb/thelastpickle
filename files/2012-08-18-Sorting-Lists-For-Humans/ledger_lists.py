"""Lists where the sort order in Cassandra matches the list order.

Changes are stored in a ledger and applied by an updater process.
"""
import csv
import json
import os.path
import time

import pycassa
from pycassa.cassandra import ttypes as cass_types

pool = pycassa.ConnectionPool("dev")
ledger_sorted_cf = pycassa.ColumnFamily(pool, "LedgerSorted", 
    read_consistency_level=cass_types.ConsistencyLevel.QUORUM, 
    write_consistency_level=cass_types.ConsistencyLevel.QUORUM)

ledger_actions_cf = pycassa.ColumnFamily(pool, "LedgerActions", 
    read_consistency_level=cass_types.ConsistencyLevel.QUORUM, 
    write_consistency_level=cass_types.ConsistencyLevel.QUORUM)


def initialise():

    def gen_countries():
        with open(os.path.join(".", "country_list.txt"), "r") as f:
            # skip header
            f.readline()
            reader = csv.reader(f, delimiter=';')
            for name_code in reader:
                yield name_code 

    for country_name, country_code in gen_countries():        
        # sort and seq set to current time to append item 
        sort = int(time.time() * 10**6)
        seq = sort

        row_key = "countries"
        columns = {
            (sort, seq, country_code) : country_name
        }
        ledger_sorted_cf.insert(row_key, columns)

    return

def move(target_col_name, next_sibling_col_name):
    """Moves the item with ``col_name`` to be before 
    ``target_col_name``.

    e.g.::
        lists.move("fruits", (1345288330031380, 1345288330031380, 5), (1345288330027208, 1345288330027208, 2))

    """

    action = {
        "action" : "move",
        "target" : target_col_name,
        "next_sibling" : next_sibling_col_name  
    }

    # read the old column so we know it's value 
    row_key = "countries"
    columns = {
        int(time.time() * 10**6) : json.dumps(action)    
    }
    ledger_actions_cf.insert(row_key, columns)

    return

def show():

    row_key = "countries"

    # if page size is 10, read 20. If more than page size actions in trouble. 

    # Get page first page of results
    sorted_cols = ledger_sorted_cf.get(row_key, column_count=20)

    # Get actions
    actions_cols = ledger_actions_cf.get(row_key, column_count=100)

    #Apply the changes
    for action_id, action_json in actions_cols.iteritems():
        action = json.loads(action_json)

        if action["action"] == "move":
            target_col_name = tuple(action["target"])
            try:
                target_col_value = sorted_cols.pop(target_col_name)
            except (KeyError):
                # target of the action is not in out list, skip the action.
                pass
            else:
                # the target item was removed, add it at it's new location
                next_sibling_col_name = action["next_sibling"] 
                new_col_name = (
                    next_sibling_col_name[0] - 1, # new sort is target sort -1
                    int(time.time() * 10**6),   # new seq is current timestamp
                    target_col_name[2]    
                )
                existing = sorted_cols.setdefault(new_col_name, 
                    target_col_value)
                assert existing == target_col_value


    sorted = [
        (key, value) 
        for key, value in sorted_cols.iteritems()
    ]
    sorted.sort(key=lambda x:x[0])
    return sorted
