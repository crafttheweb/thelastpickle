"""Lists where the sort order in Cassandra does not match the list order.
"""

import random
import time

import pycassa
from pycassa.cassandra import ttypes as cass_types

pool = pycassa.ConnectionPool("dev")
unsorted_cf = pycassa.ColumnFamily(pool, "Unsorted", 
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
        (item_id, "label") : label,
        (item_id, "order") : "%s,%s" % (sort, seq)
    }
    unsorted_cf.insert(row_key, columns)
    return

def move(list_name, item_id, target_item_sort):
    """Moves the item ``item_id`` to be before 
    ``target_item_sort``.

    e.g.::
        lists.move("fruits", 5, (1345288330027208, 1345288330027208))

    """

    # Update the sort property for item 
    row_key = list_name 
    new_order = (
        target_item_sort[0] - 1,    # new sort is target sort -1
        int(time.time() * 10**6),   # new seq is current timestamp
    )
    columns = {
        (item_id, "order") : "%s,%s" % new_order
    }
    unsorted_cf.insert(row_key, columns)
    return

def initialise():

    local_items = list(items)
    random.shuffle(local_items)
    for item_id, label in local_items:
        append_item("fruits", item_id, label)
    return

def show():

    row_key = "fruits"
    cols = unsorted_cf.get(row_key)

    # zip together the label and order
    unsorted = []
    for label_col, order_col in zip(cols.keys()[::2], cols.keys()[1::2]):
        # label_col is (item_id, "label")
        # order_col is (item_id, "order")

        item_id = label_col[0]
        label = cols[label_col]
        order = tuple(int(i) for i in cols[order_col].split(","))
        
        unsorted.append( (order, (item_id, label) ))

    # Unsorted is a list of [ ((sort,seq), (item_id, lable)) ] 
    unsorted.sort(key=lambda x:x[0])
    return unsorted

