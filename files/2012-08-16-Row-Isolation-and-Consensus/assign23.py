import pycassa
from pycassa.cassandra import ttypes as cass_types

class CF23(object):
    """Atomic multi assignment to a 3 element array using Cassandra."""
    
    def __init__(self, name, cf_name, pool):

        self.name = name
        self.pool = pool
        self.cf = pycassa.ColumnFamily(self.pool, cf_name, 
            read_consistency_level=cass_types.ConsistencyLevel.QUORUM, 
            write_consistency_level=cass_types.ConsistencyLevel.QUORUM)
        # do not set an inital value, rely on defaults. 

    def assign(self, v0, v1, i0, i1):
        assert all(x in [0,1,2] for x in (i0, i1))
        assert all(x in [0,1] for x in (v0, v1))

        row_key = self.name
        columns = {
            "element_%s" % i0 : v0,
            "element_%s" % i1 : v1
        }
        self.cf.insert(row_key, columns)
        return

    def read(self, i):
        row_key = self.name
        columns = [
            "element_%s" % i
        ]
        
        try:
            return self.cf.get(row_key, columns=columns)["element_%s" % i]
        except (KeyError):
            # -1 is the default 
            return -1
        except (pycassa.NotFoundException):
            # -1 is the default 
            return -1

class Consensus2(object):

    def __init__(self, name):

        self.name = name
        self.pool = pycassa.ConnectionPool("dev")
        self.cf = pycassa.ColumnFamily(self.pool, "cf23", 
            read_consistency_level=cass_types.ConsistencyLevel.QUORUM, 
            write_consistency_level=cass_types.ConsistencyLevel.QUORUM)

        self.cf23 = CF23(name, "cf23", self.pool)
        return

    def propose(self, client_id, value):
        assert client_id == 0 or client_id == 1

        row_key = self.name
        columns = {
            "propose_%s" % client_id : value
        }
        self.cf.insert(row_key, columns)
        return

    def proposed(self, client_id):

        row_key = self.name
        columns = [
            "propose_%s" % client_id
        ]
        return self.cf.get(row_key, columns)["propose_%s" % client_id]

    def decide(self, client_id, value):
        """Decides if ``client_id``'s ``value`` is winning value for this 
        consensus object. 

        Returns (i_won, winning_value) where i_won is true if ``client_id`` 
        was the winning client. And ``winning_value`` is the consensus value.
        """ 
        assert client_id == 0 or client_id == 1

        self.propose(client_id, value)
        self.cf23.assign(client_id, client_id, client_id, client_id+1);

        # if we are client 0 read element 2, if we are client 1 read element 0
        other = self.cf23.read((client_id + 2) % 3)
        if (other == -1 or other == self.cf23.read(1)):
            # I win. 
            # Case 1: element 2 is -1
            # Case 2: element 1 and 2 are set and have same value
            return (True, self.proposed(client_id))
        else:
            # I lose. 
            # Case 3: element 1 and 2 are set and have different value
            return (False, self.proposed(1 - client_id))
