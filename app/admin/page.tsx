export default function Admin() {

  return (
    <div>

      <h1 className="text-3xl font-bold mb-6">
        Dashboard
      </h1>

      <div className="grid grid-cols-3 gap-4">

        <div className="card">
          <h3>Total Items</h3>
          <p className="text-2xl mt-2">0</p>
        </div>

        <div className="card">
          <h3>Jobs</h3>
          <p className="text-2xl mt-2">0</p>
        </div>

        <div className="card">
          <h3>Errors</h3>
          <p className="text-2xl mt-2">0</p>
        </div>

      </div>

    </div>
  );
}