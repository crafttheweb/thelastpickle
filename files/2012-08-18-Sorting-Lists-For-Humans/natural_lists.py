"""Lists where the sort order in Cassandra matches the list order.
"""

import time

import pycassa
from pycassa.cassandra import ttypes as cass_types

pool = pycassa.ConnectionPool("dev")
sorted_cf = pycassa.ColumnFamily(pool, "Sorted", 
    read_consistency_level=cass_types.ConsistencyLevel.QUORUM, 
    write_consistency_level=cass_types.ConsistencyLevel.QUORUM)

items = [
    (1, "Apples"), 
    (2, "Bananas"),
    (3, "Cherries"), 
    (4, "Dragon Fruit"),
    (5, "Elderberry")
]

def append_item(list_name, item_id, label):
    """Appends the item to the end of the named list.
    """

    # sort and seq set to current time to append item 
    sort = int(time.time() * 10**6)
    seq = sort

    row_key = list_name
    columns = {
        (sort, seq, item_id) : label
    }
    sorted_cf.insert(row_key, columns)
    return

def move(list_name, col_name, target_col_name):
    """Moves the item with ``col_name`` to be before 
    ``target_col_name``.

    e.g.::
        lists.move("fruits", (1345288330031380, 1345288330031380, 5), (1345288330027208, 1345288330027208, 2))

    """

    # read the old column so we know it's value 
    row_key = list_name 
    columns = [
        col_name
    ]
    col_value = sorted_cf.get(row_key, columns=columns)[col_name]

    new_col_name = (
        target_col_name[0] - 1,     # new sort is target sort -1
        int(time.time() * 10**6),   # new seq is current timestamp
        col_name[2]                 # new id is same as old.
    ) 

    # delete old column
    columns = [
        col_name
    ]
    sorted_cf.remove(row_key, columns=columns)

    # add new column 
    columns = {
        new_col_name : col_value
    }
    sorted_cf.insert(row_key, columns)
    return

def initialise():

    for item_id, label in items:
        append_item("fruits", item_id, label)
    return


